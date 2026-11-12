# Owns read-only Windows app screenshots; never activates, restores, or sends input to windows.
"""Capture one unminimized app window with PrintWindow; uses only Python's standard library."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import struct
import sys
import zlib


def capture(process, title, output, target_pid=None):
    if sys.platform != 'win32':
        raise RuntimeError('Windows is required.')
    user = C.WinDLL('user32', use_last_error=True)
    kernel = C.WinDLL('kernel32', use_last_error=True)
    gdi = C.WinDLL('gdi32', use_last_error=True)
    user.SetThreadDpiAwarenessContext.argtypes = [W.HANDLE]
    user.SetThreadDpiAwarenessContext.restype = W.HANDLE
    user.SetThreadDpiAwarenessContext(W.HANDLE(-4))
    user.GetForegroundWindow.restype = W.HWND
    before = user.GetForegroundWindow()
    user.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]
    kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    kernel.OpenProcess.restype = W.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD)]
    kernel.CloseHandle.argtypes = [W.HANDLE]
    user.GetWindowTextLengthW.argtypes = [W.HWND]
    user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
    user.IsWindowVisible.argtypes = [W.HWND]
    user.IsIconic.argtypes = [W.HWND]
    expected = os.path.normcase(os.path.abspath(process))
    matches = []
    callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

    def visit(hwnd, _):
        if not user.IsWindowVisible(hwnd):
            return True
        text = C.create_unicode_buffer(user.GetWindowTextLengthW(hwnd) + 1)
        user.GetWindowTextW(hwnd, text, len(text))
        if text.value != title:
            return True
        pid = W.DWORD()
        user.GetWindowThreadProcessId(hwnd, C.byref(pid))
        if target_pid is not None and pid.value != target_pid:
            return True
        handle = kernel.OpenProcess(0x1000, False, pid.value)
        if not handle:
            return True
        try:
            path = C.create_unicode_buffer(32768)
            size = W.DWORD(len(path))
            if kernel.QueryFullProcessImageNameW(handle, 0, path, C.byref(size)) and os.path.normcase(path.value) == expected:
                matches.append((hwnd, pid.value, path.value))
        finally:
            kernel.CloseHandle(handle)
        return True

    user.EnumWindows.argtypes = [callback_type, W.LPARAM]
    if not user.EnumWindows(callback_type(visit), 0):
        raise C.WinError(C.get_last_error())
    if len(matches) != 1:
        raise RuntimeError(f'Expected one visible window for exact process/title; found {len(matches)}.')
    hwnd, pid, executable = matches[0]
    if user.IsIconic(hwnd):
        raise RuntimeError('Window is minimized; capture was refused without restoring it.')
    rect = W.RECT()
    user.GetWindowRect.argtypes = [W.HWND, C.POINTER(W.RECT)]
    if not user.GetWindowRect(hwnd, C.byref(rect)):
        raise C.WinError(C.get_last_error())
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0 or width * height > 40_000_000:
        raise RuntimeError(f'Unsupported window dimensions: {width}x{height}.')

    class Header(C.Structure):
        _fields_ = [('size', W.DWORD), ('width', W.LONG), ('height', W.LONG), ('planes', W.WORD), ('bits', W.WORD), ('compression', W.DWORD), ('image_size', W.DWORD), ('x', W.LONG), ('y', W.LONG), ('used', W.DWORD), ('important', W.DWORD)]

    class Info(C.Structure):
        _fields_ = [('header', Header), ('colors', W.DWORD * 3)]

    gdi.CreateCompatibleDC.argtypes = [W.HDC]
    gdi.CreateCompatibleDC.restype = W.HDC
    gdi.CreateDIBSection.argtypes = [W.HDC, C.POINTER(Info), W.UINT, C.POINTER(C.c_void_p), W.HANDLE, W.DWORD]
    gdi.CreateDIBSection.restype = W.HBITMAP
    gdi.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
    gdi.SelectObject.restype = W.HGDIOBJ
    gdi.DeleteObject.argtypes = [W.HGDIOBJ]
    gdi.DeleteDC.argtypes = [W.HDC]
    user.PrintWindow.argtypes = [W.HWND, W.HDC, W.UINT]
    dc = gdi.CreateCompatibleDC(None)
    if not dc:
        raise C.WinError(C.get_last_error())
    bitmap = previous = None
    try:
        info = Info()
        info.header = Header(C.sizeof(Header), width, -height, 1, 32, 0, 0, 0, 0, 0, 0)
        pixels = C.c_void_p()
        bitmap = gdi.CreateDIBSection(dc, C.byref(info), 0, C.byref(pixels), None, 0)
        if not bitmap:
            raise C.WinError(C.get_last_error())
        previous = gdi.SelectObject(dc, bitmap)
        if not previous or previous == W.HGDIOBJ(-1).value:
            raise RuntimeError('Could not select capture bitmap.')
        if not user.PrintWindow(hwnd, dc, 2):
            raise RuntimeError('PrintWindow failed; no foreground/desktop capture fallback was attempted.')
        bgra = C.string_at(pixels, width * height * 4)
    finally:
        if previous and previous != W.HGDIOBJ(-1).value:
            gdi.SelectObject(dc, previous)
        if bitmap:
            gdi.DeleteObject(bitmap)
        gdi.DeleteDC(dc)
    # PrintWindow can succeed with stale/blank GPU content. Human visual inspection is required.
    rgb = bytearray(width * height * 3)
    rgb[0::3], rgb[1::3], rgb[2::3] = bgra[2::4], bgra[1::4], bgra[0::4]
    if not any(rgb):
        raise RuntimeError('Capture is entirely black; renderer may not support PrintWindow.')
    rows = b''.join(b'\x00' + rgb[row * width * 3:(row + 1) * width * 3] for row in range(height))

    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(png)
    after = user.GetForegroundWindow()
    return {'path': str(output), 'process': executable, 'pid': pid, 'title': title, 'width': width, 'height': height, 'foreground_unchanged': before == after, 'target_foreground': before == hwnd, 'method': 'PrintWindow PW_RENDERFULLCONTENT; inspect image for stale/blank GPU content'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--process', required=True, help='Exact absolute executable path; ambiguous targets are rejected.')
    parser.add_argument('--title', default='Negareh', help='Exact window title (default: Negareh).')
    parser.add_argument('--pid', type=int, help='Optional verified process ID for multiple instances.')
    parser.add_argument('--output', required=True, help='Output PNG path.')
    args = parser.parse_args()
    try:
        print(json.dumps(capture(args.process, args.title, args.output, args.pid)))
    except (OSError, RuntimeError) as error:
        parser.exit(1, f'Capture failed: {error}\n')



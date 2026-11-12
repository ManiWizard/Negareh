// Owns the opt-in development HMR-to-MCP adapter; production builds omit this module.
export interface AppRequest {
  action: string;
  value?: string | undefined; target?: string | undefined;
  path?: string | undefined; savePath?: string | undefined;
  decision?: string | undefined; overwrite?: boolean | undefined;
  other?: string | undefined; axis?: string | undefined; ratio?: number | undefined; index?: number | undefined; enabled?: boolean | undefined; field?: string | undefined;
  x?: number | undefined; y?: number | undefined; width?: number | undefined; height?: number | undefined;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function parse(value: unknown): AppRequest {
  if (!record(value) || typeof value.action !== 'string') throw new Error('Invalid MCP action.');
  const text = (key: string): string | undefined => typeof value[key] === 'string' ? value[key] : undefined;
  const number = (key: string): number | undefined => typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined;
  return { action: value.action, other: text('other'), axis: text('axis'), field: text('field'), ratio: number('ratio'), index: number('index'), enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined, value: text('value'), target: text('target'), path: text('path'), savePath: text('savePath'), decision: text('decision'), overwrite: value.overwrite === true, x: number('x'), y: number('y'), width: number('width'), height: number('height') };
}
export function setupMcp(run: (request: AppRequest) => Promise<unknown>, signal: AbortSignal): void {
  const hot = import.meta.hot;
  if (!hot) return;
  const handler = async (message: unknown): Promise<void> => {
    if (signal.aborted || !record(message) || typeof message.id !== 'string') return;
    const id = message.id;
    try { hot.send('negareh:result', { id, result: await run(parse(message.args)) }); }
    catch (error) { hot.send('negareh:result', { id, result: { ok: false, error: error instanceof Error ? error.message : String(error) } }); }
  };
  const receive = (message: unknown): void => { handler(message).catch((error: unknown) => { console.error(error); }); };
  hot.on('negareh:request', receive);
  hot.send('negareh:hello', {});
  signal.addEventListener('abort', () => { hot.off('negareh:request', receive); }, { once: true });
}



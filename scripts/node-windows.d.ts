declare module "node-windows" {
  export class Service {
    constructor(o: { name: string; description: string; script: string; workingDirectory?: string; wait?: number; grow?: number; maxRestarts?: number });
    on(evento: string, fn: (...a: any[]) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
  }
  const _default: { Service: typeof Service };
  export default _default;
}

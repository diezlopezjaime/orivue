import { OrivueEngine } from '@orivue/engine';
import { getPlatform, type AppPlatform, type DeviceInfo } from './platform';

let engineInstance: OrivueEngine | undefined;
let platformInstance: AppPlatform | undefined;
let deviceInstance: DeviceInfo | undefined;
let booting: Promise<void> | undefined;

export async function bootstrap(): Promise<void> {
  booting ??= (async () => {
    const platform = await getPlatform();
    const engine = new OrivueEngine({ platform: platform.engine });
    await engine.init();
    engine.startAutoRefresh();
    platformInstance = platform;
    engineInstance = engine;
    deviceInstance = await platform.device();
  })();
  await booting;
}

export function getEngine(): OrivueEngine {
  if (!engineInstance) throw new Error('El motor de Orivue todavía no está iniciado');
  return engineInstance;
}

export function getAppPlatform(): AppPlatform {
  if (!platformInstance) throw new Error('La plataforma todavía no está iniciada');
  return platformInstance;
}

export function getDevice(): DeviceInfo {
  return (
    deviceInstance ?? {
      platform: 'browser',
      tauri: false,
      mobile: false,
      tv: false,
      touchscreen: false,
      nativePlayer: false,
      version: 'dev',
    }
  );
}

/** Test seam: inject a ready engine and platform. */
export function setEngineForTests(
  engine: OrivueEngine | undefined,
  platform?: AppPlatform,
  device?: DeviceInfo,
): void {
  engineInstance = engine;
  platformInstance = platform;
  deviceInstance = device;
  booting = engine ? Promise.resolve() : undefined;
}

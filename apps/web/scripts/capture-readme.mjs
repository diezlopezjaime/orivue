import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/api/groups', (route) =>
    route.fulfill({
      json: [
        { id: 'demo', name: 'Demo', channelCount: 3 },
        { id: 'culture', name: 'Cultura', channelCount: 2 },
      ],
    }),
  );
  await page.route('**/api/channels**', (route) =>
    route.fulfill({
      json: [
        { id: 'one', name: 'Orivue News', groupId: 'demo', groupName: 'Demo' },
        { id: 'two', name: 'Horizonte', groupId: 'demo', groupName: 'Demo' },
        { id: 'three', name: 'Patrón local', groupId: 'demo', groupName: 'Demo' },
        { id: 'four', name: 'Cultura abierta', groupId: 'culture', groupName: 'Cultura' },
        { id: 'five', name: 'Archivo sintético', groupId: 'culture', groupName: 'Cultura' },
      ],
    }),
  );
  await page.route('**/api/epg/now**', (route) => route.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('heading', { name: 'Todos los canales' }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL('../../../docs/orivue-interface.png', import.meta.url)),
  });
} finally {
  await browser.close();
}

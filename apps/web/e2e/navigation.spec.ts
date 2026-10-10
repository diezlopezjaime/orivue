import { expect, test } from '@playwright/test';

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="aurora" group-title="Noticias",Canal Aurora
https://streams.test/aurora/index.m3u8
#EXTINF:-1 tvg-id="horizonte" group-title="Noticias",Canal Horizonte
https://streams.test/horizonte.ts
`;

test.beforeEach(async ({ page }) => {
  await page.route('https://lists.test/**', (route) =>
    route.fulfill({ body: PLAYLIST, contentType: 'audio/x-mpegurl' }),
  );
  await page.route('https://streams.test/**', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
});

test('lists screen has a clear empty state', async ({ page }) => {
  await page.getByRole('link', { name: 'Mis listas' }).click();
  await expect(page.getByText('Tu biblioteca está vacía')).toBeVisible();
});

test('imports a playlist, browses it with the keyboard and opens the player', async ({ page }) => {
  await page.getByRole('link', { name: 'Mis listas' }).click();
  await page.getByRole('button', { name: '+ Añadir lista' }).click();
  await page.getByPlaceholder('Televisión de casa').fill('Demo');
  await page
    .getByPlaceholder('https://servidor.ejemplo/lista.m3u')
    .fill('https://lists.test/demo.m3u');
  await page.getByRole('button', { name: 'Importar URL' }).click();
  await expect(page.getByText('2 canales')).toBeVisible();
  await page.getByRole('link', { name: 'En directo' }).click();
  const channel = page.getByRole('button', { name: 'Reproducir Canal Aurora' });
  await expect(channel).toBeVisible();
  await channel.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Reproducir Canal Horizonte' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Reproduciendo Canal Horizonte' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('persists sources across reloads and detects Xtream URLs', async ({ page }) => {
  await page.route('http://panel.test:8080/**', (route) => {
    const url = route.request().url();
    if (url.includes('player_api.php'))
      return route.fulfill({
        json: { user_info: { status: 'Active', auth: 1, max_connections: '2' }, server_info: {} },
      });
    if (url.includes('xmltv.php'))
      return route.fulfill({ body: '<tv></tv>', contentType: 'text/xml' });
    return route.fulfill({ body: PLAYLIST, contentType: 'audio/x-mpegurl' });
  });
  await page.getByRole('link', { name: 'Mis listas' }).click();
  await page.getByRole('button', { name: '+ Añadir lista' }).click();
  await page.getByPlaceholder('Televisión de casa').fill('Panel');
  await page
    .getByPlaceholder('https://servidor.ejemplo/lista.m3u')
    .fill('http://panel.test:8080/get.php?username=u&password=p&type=m3u_plus&output=ts');
  await page.getByRole('button', { name: 'Importar URL' }).click();
  await expect(page.locator('.kind-chip', { hasText: 'Xtream Codes' })).toBeVisible();
  await expect(page.getByText(/2 conexiones/)).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Mis listas' }).click();
  await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible();
});

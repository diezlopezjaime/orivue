import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/groups', (route) =>
    route.fulfill({ json: [{ id: 'news', name: 'Noticias', channelCount: 2 }] }),
  );
  await page.route('**/api/channels**', (route) =>
    route.fulfill({
      json: [
        {
          id: 'one',
          name: 'Canal Aurora',
          number: 1,
          groupId: 'news',
          groupName: 'Noticias',
          now: {
            channelId: 'one',
            title: 'Boletín abierto',
            startsAt: new Date(Date.now() - 600000).toISOString(),
            endsAt: new Date(Date.now() + 1200000).toISOString(),
          },
        },
        { id: 'two', name: 'Canal Horizonte', number: 2, groupId: 'news', groupName: 'Noticias' },
      ],
    }),
  );
  await page.route('**/api/epg/now**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/playback/sessions', (route) =>
    route.fulfill({ json: { id: 'session', url: '/fixture.m3u8', type: 'hls' } }),
  );
  await page.route('**/api/playback/sessions/*', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/playlists', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
});

test('keyboard navigation opens and closes the player', async ({ page }) => {
  const channel = page.getByRole('button', { name: 'Reproducir Canal Aurora' });
  await expect(channel).toBeVisible();
  await channel.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Reproduciendo Canal Aurora' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lists screen has a clear empty state', async ({ page }) => {
  await page.getByRole('link', { name: 'Mis listas' }).click();
  await expect(page.getByText('Tu biblioteca está vacía')).toBeVisible();
});

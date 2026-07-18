import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { moveSpatialFocus } from './focus';

describe('TV focus navigation', () => {
  it('moves focus to the closest element in the requested direction', () => {
    render(
      <>
        <button data-tv-focus>Uno</button>
        <button data-tv-focus>Dos</button>
      </>,
    );
    const one = screen.getByRole('button', { name: 'Uno' });
    const two = screen.getByRole('button', { name: 'Dos' });
    vi.spyOn(one, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 50,
      top: 0,
      bottom: 40,
      width: 50,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });
    vi.spyOn(two, 'getBoundingClientRect').mockReturnValue({
      left: 80,
      right: 130,
      top: 0,
      bottom: 40,
      width: 50,
      height: 40,
      x: 80,
      y: 0,
      toJSON: () => undefined,
    });
    one.focus();
    expect(moveSpatialFocus('right')).toBe(true);
    expect(document.activeElement).toBe(two);
  });

  it('keeps standard Enter activation', () => {
    const clicked = vi.fn();
    render(
      <button data-tv-focus onClick={clicked}>
        Canal
      </button>,
    );
    const button = screen.getByRole('button');
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    button.click();
    expect(clicked).toHaveBeenCalledOnce();
  });
});

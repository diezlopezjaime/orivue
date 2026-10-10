import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useNumericZap } from './useNumericZap';

function Probe({ onNumber }: { onNumber: (value: number) => void }) {
  const digits = useNumericZap(onNumber);
  return <output>{digits || 'idle'}</output>;
}

describe('useNumericZap', () => {
  it('accumulates digits and resolves after a pause or Enter', async () => {
    const user = userEvent.setup();
    const onNumber = vi.fn();
    render(<Probe onNumber={onNumber} />);
    await user.keyboard('1');
    await user.keyboard('2');
    expect(screen.getByRole('status').textContent).toBe('12');
    await vi.waitFor(() => expect(onNumber).toHaveBeenCalledWith(12), { timeout: 3000 });
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('idle'));
    await user.keyboard('7');
    await user.keyboard('{Enter}');
    expect(onNumber).toHaveBeenLastCalledWith(7);
  });
});

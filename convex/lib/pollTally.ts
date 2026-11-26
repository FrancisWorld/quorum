export interface PollOption {
  id: string;
  label: string;
}

export interface OptionResult extends PollOption {
  votes: number;
  /** Whole percent; the set always sums to 100 once anyone has voted. */
  percent: number;
}

export interface PollResult {
  total: number;
  options: OptionResult[];
}

/** Largest-remainder rounding so displayed percentages add up to exactly 100. */
export function tallyPoll(options: readonly PollOption[], votedOptionIds: readonly string[]): PollResult {
  const counts = new Map(options.map((option) => [option.id, 0]));
  for (const id of votedOptionIds) {
    const current = counts.get(id);
    if (current !== undefined) counts.set(id, current + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  const shares = options.map((option, index) => {
    const votes = counts.get(option.id) ?? 0;
    const exact = total === 0 ? 0 : (votes / total) * 100;
    return { index, votes, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let leftover = total === 0 ? 0 : 100 - shares.reduce((sum, s) => sum + s.floor, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const bonus = new Map<number, number>();
  for (const share of byRemainder) {
    if (leftover <= 0) break;
    bonus.set(share.index, 1);
    leftover -= 1;
  }

  return {
    total,
    options: options.map((option, index) => ({
      ...option,
      votes: shares[index]?.votes ?? 0,
      percent: (shares[index]?.floor ?? 0) + (bonus.get(index) ?? 0),
    })),
  };
}

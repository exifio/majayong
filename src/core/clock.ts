export interface Clock {
  now(): Date;
}

export interface MutableClock extends Clock {
  set(instant: Date): void;
  advance(milliseconds: number): void;
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}

export function mutableClock(instant: Date): MutableClock {
  let current = instant.getTime();
  return {
    now: () => new Date(current),
    set: (next: Date) => { current = next.getTime(); },
    advance: (milliseconds: number) => { current += milliseconds; },
  };
}

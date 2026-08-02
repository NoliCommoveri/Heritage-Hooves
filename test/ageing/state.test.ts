import { describe, expect, it } from 'vitest';
import { ageState, type AgeStateConfig, type AgeStateHorse } from '../../src/engines/ageing/lifespan';

// The starting numbers from migrations/0060_config_ageing.sql/0016_config_breeding.sql.
const CONFIG: AgeStateConfig = {
  frailty_window_game_days: 540,
  veteran_age_game_days: 6480,
  min_breeding_age_game_days: 1080,
};

const BORN = 10000;

function horse(overrides: Partial<AgeStateHorse> = {}): AgeStateHorse {
  return { bornGameDay: BORN, naturalDeathGameDay: BORN + 8280, status: 'alive', ...overrides };
}

describe('ageState - ended', () => {
  it('a dead horse always reads ended, at any age', () => {
    expect(ageState(horse({ status: 'dead' }), BORN + 100, CONFIG)).toBe('ended');
    expect(ageState(horse({ status: 'dead' }), BORN + 20000, CONFIG)).toBe('ended');
  });

  it('a removed (retired away) horse always reads ended', () => {
    expect(ageState(horse({ status: 'removed' }), BORN + 100, CONFIG)).toBe('ended');
  });

  it('ended wins even when the numbers would otherwise say failing', () => {
    const h = horse({ status: 'dead', naturalDeathGameDay: BORN + 100 });
    expect(ageState(h, BORN + 100, CONFIG)).toBe('ended');
  });
});

describe('ageState - failing (about remaining life, not age)', () => {
  it('exactly at the frailty window reads failing', () => {
    const h = horse({ naturalDeathGameDay: BORN + 5000 });
    const gameDay = BORN + 5000 - CONFIG.frailty_window_game_days;
    expect(ageState(h, gameDay, CONFIG)).toBe('failing');
  });

  it('one day further out does not read failing', () => {
    const h = horse({ naturalDeathGameDay: BORN + 5000 });
    const gameDay = BORN + 5000 - CONFIG.frailty_window_game_days - 1;
    expect(ageState(h, gameDay, CONFIG)).not.toBe('failing');
  });

  it('a null natural_death_game_day never reads failing, at any age', () => {
    const h = horse({ naturalDeathGameDay: null });
    expect(ageState(h, BORN, CONFIG)).not.toBe('failing');
    expect(ageState(h, BORN + 1080, CONFIG)).not.toBe('failing');
    expect(ageState(h, BORN + 6480, CONFIG)).not.toBe('failing');
    expect(ageState(h, BORN + 999999, CONFIG)).not.toBe('failing');
  });

  it('a short-lifespan horse reads failing before it reads veteran (§4.4\'s accepted oddity)', () => {
    // Lifespan of 6000 game days (under 18 years) - never reaches veteran_age_game_days (6480) at
    // all, but is failing for the last 540 days of its life.
    const h = horse({ naturalDeathGameDay: BORN + 6000 });
    const gameDay = BORN + 6000 - CONFIG.frailty_window_game_days;
    expect(ageState(h, gameDay, CONFIG)).toBe('failing');
    // Confirm it would never have reached veteran under this config - the whole point of the oddity.
    expect(gameDay - h.bornGameDay).toBeLessThan(CONFIG.veteran_age_game_days);
  });
});

describe('ageState - veteran (about age, not remaining life)', () => {
  it('exactly at veteran_age_game_days reads veteran', () => {
    const h = horse({ naturalDeathGameDay: null });
    expect(ageState(h, BORN + CONFIG.veteran_age_game_days, CONFIG)).toBe('veteran');
  });

  it('one day younger reads adult, not veteran', () => {
    const h = horse({ naturalDeathGameDay: null });
    expect(ageState(h, BORN + CONFIG.veteran_age_game_days - 1, CONFIG)).toBe('adult');
  });
});

describe('ageState - young', () => {
  it('one day short of min_breeding_age_game_days reads young', () => {
    const h = horse({ naturalDeathGameDay: null });
    expect(ageState(h, BORN + CONFIG.min_breeding_age_game_days - 1, CONFIG)).toBe('young');
  });

  it('exactly at min_breeding_age_game_days reads adult, not young', () => {
    const h = horse({ naturalDeathGameDay: null });
    expect(ageState(h, BORN + CONFIG.min_breeding_age_game_days, CONFIG)).toBe('adult');
  });
});

describe('ageState - adult', () => {
  it('everything between min_breeding_age_game_days and veteran_age_game_days, with no frailty pending, reads adult', () => {
    const h = horse({ naturalDeathGameDay: BORN + 50000 });
    expect(ageState(h, BORN + 3000, CONFIG)).toBe('adult');
  });
});

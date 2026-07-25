import { describe, it, expect } from 'vitest';
import { weddingFloorplansPlan } from './weddingSource.js';

describe('weddingFloorplansPlan — role-based floorplans source (#weddings-select hardening)', () => {
  it('routes the helper through the get_wedding_floorplans projection RPC', () => {
    expect(weddingFloorplansPlan('helper')).toEqual({ kind: 'rpc', fn: 'get_wedding_floorplans' });
  });

  it('gives the couple the direct weddings.floorplans select', () => {
    expect(weddingFloorplansPlan('couple')).toEqual({ kind: 'select', table: 'weddings', column: 'floorplans' });
  });

  it('falls back to the direct select when the role is not yet known (RLS is the real gate)', () => {
    expect(weddingFloorplansPlan(null)).toEqual({ kind: 'select', table: 'weddings', column: 'floorplans' });
    expect(weddingFloorplansPlan(undefined)).toEqual({ kind: 'select', table: 'weddings', column: 'floorplans' });
  });

  it('treats unknown role strings as non-helpers', () => {
    expect(weddingFloorplansPlan('intruder')).toEqual({ kind: 'select', table: 'weddings', column: 'floorplans' });
  });
});

import { describe, expect, it } from 'vitest';
import { loadSettings, PlaybackClock, saveSettings, trackKey } from './model';
import type { MediaSession } from './model';

const s: MediaSession = { id:'fixture',source:'fixture',title:'Study',artist:'Artist',album:'Album',durationMs:10000, positionMs:1000,playing:true,timelineValid:true };
describe('playback clock', () => {
  it('advances from anchor with rate, clamps to duration, and does not accumulate duplicate reports', () => {
    const clock = new PlaybackClock();
    clock.update({...s,rate:1.5}, false, 100);
    expect(clock.at(300)).toBe(1300);
    clock.update({...s,rate:1.5}, false, 300);
    expect(clock.at(400)).toBe(1450);
    expect(clock.at(10000)).toBe(10000);
  });
  it('freezes paused playback and immediately reanchors a backward or forward seek', () => {
    const clock = new PlaybackClock();
    clock.update(s, false, 100);
    clock.update({...s,positionMs:6000}, false, 110);
    expect(clock.at(110)).toBe(6000);
    clock.update({...s,positionMs:300,playing:false}, false, 150);
    expect(clock.at(620)).toBe(300);
    clock.update({...s,positionMs:300,playing:true}, false, 650);
    expect(clock.at(950)).toBe(600);
  });
  it('invalidates missing timelines, even on an otherwise populated track', () => {
    const clock = new PlaybackClock();
    clock.update(s, false, 100);
    clock.update({...s,timelineValid:false}, false, 150);
    expect(clock.valid).toBe(false); expect(clock.at(999)).toBe(0);
  });
  it('does not hold an old song on a change', () => {
    const clock = new PlaybackClock();
    clock.update(s, false, 100);
    clock.update({...s,title:'Next song',positionMs:0}, true, 200);
    expect(clock.at(200)).toBe(0);
    expect(trackKey(s)).not.toBe(trackKey({...s,title:'Study (Live)'}));
  });
});

describe('persisted settings', () => {
  it('preserves valid Zen gradients and rejects malformed persisted points', () => {
    const store = new Map<string,string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    const valid = loadSettings();
    valid.zenBlendMode = 'screen';
    valid.zenPoints = [{ id:'fixture', x:0.25, y:0.75, color:'#abcdef', spread:1.4, intensity:0.8 }];
    saveSettings(valid);
    expect(loadSettings().zenBlendMode).toBe('screen');
    expect(loadSettings().zenPoints[0]).toMatchObject({ id:'fixture', x:0.25, y:0.75, color:'#abcdef' });

    store.set('lyricmotion.settings.v1', JSON.stringify({
      zenBlendMode: 'invalid',
      zenPoints: [{ id:'bad', x:2, y:-1, color:'purple', spread:NaN, intensity:Infinity }],
    }));
    const recovered = loadSettings();
    expect(recovered.zenBlendMode).toBe('normal');
    expect(recovered.zenPoints.length).toBeGreaterThan(0);
    expect(recovered.zenPoints.every(point => /^#[0-9a-f]{6}$/i.test(point.color))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { PlaybackClock } from './model';
import type { MediaSession } from './model';
import { formatTransportTime, projectTransport } from './transport';

const track: MediaSession = {id:'player', source:'fixture', title:'Fixture', artist:'Fixture', album:'',
  positionMs:81_050, durationMs:229_000, playing:true, rate:1, timelineValid:true};

describe('live transport', () => {
  it('reports media progress, not demo duration or adjusted lyric time', () => {
    const view = projectTransport(track.positionMs, track.durationMs, -2600);
    expect(formatTransportTime(view.duration)).toBe('3:49');
    expect(formatTransportTime(view.playhead)).toBe('1:21');
    expect(view.fraction).toBeCloseTo(81_050 / 229_000);
    expect(view.cueTime).toBe(78_450);
  });

  it('does not manufacture a fraction or use the last lyric as track duration', () => {
    expect(projectTransport(31_000, undefined)).toEqual({playhead:31_000, duration:null, fraction:0, cueTime:31_000});
    expect(projectTransport(undefined, 229_000, 1000).cueTime).toBeNull();
    expect(formatTransportTime(null)).toBe('—');
    expect(formatTransportTime(3_726_000)).toBe('1:02:06');
  });

  it('uses actual native state across pause, backward seek, and resumption', () => {
    const clock = new PlaybackClock();
    clock.update(track, true, 0);
    expect(clock.at(1250)).toBe(82_300);
    clock.update({...track, playing:false, positionMs:82_300}, false, 1250);
    expect(clock.at(3600)).toBe(82_300);
    clock.update({...track, playing:false, positionMs:11_000}, false, 3600);
    expect(clock.at(4000)).toBe(11_000);
    clock.update({...track, positionMs:11_000, rate:1.5}, false, 4000);
    expect(clock.at(5000)).toBe(12_500);
    clock.update({...track, timelineValid:false}, true, 5000);
    expect(clock.duration).toBe(0);
  });

  it('accepts duration-only updates without corrupting the running anchor', () => {
    const clock = new PlaybackClock();
    clock.update(track, true, 0);
    clock.update({...track, durationMs:230_000}, false, 1000);
    expect(clock.duration).toBe(230_000);
    expect(clock.at(1100)).toBe(82_150);
  });
});

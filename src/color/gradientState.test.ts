import { describe, expect, it } from 'vitest';
import { decodeGradientPreset, normalizePoints } from './gradientState';
const dot = {id:'first', x:-.1, y:1.8, color:'#AaF', spread:200, intensity:0};
describe('gradient state', () => {
  it('clamps finite coordinates, normalizes hex, and ignores duplicates and unsupported input', () => {
    expect(normalizePoints([dot, dot, {...dot,id:'two',x:NaN}, {...dot,id:'three',color:'url(x)'}]))
      .toEqual([{id:'first',x:0,y:1,color:'#aaaaff',spread:3.5,intensity:.1}]);
    expect(normalizePoints(Array.from({length:20},(_,i) => ({...dot,id:`dot-${i}`})))).toHaveLength(6);
  });
  it('migrates a legacy preset and validates schema before importing it', () => {
    const result = decodeGradientPreset(JSON.stringify({points:[dot],blend:'bad',rotation:220}));
    expect(result).toMatchObject({version:1,blend:'normal',auto:false,rotation:180});
    expect(decodeGradientPreset(JSON.stringify({...result, auto:true, blend:'screen'})))
      .toMatchObject({version:1,auto:true,blend:'screen'});
    expect(decodeGradientPreset('null')).toBeNull();
    expect(decodeGradientPreset('{"version":2,"points":[]}')).toBeNull();
  });
});

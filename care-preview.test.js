const assert = require('node:assert/strict');
const { analyze, RULES } = require('./care-preview.js');

const baseCheckin = { moods:['calm'], issue:'health', energy:3, expectation:'unsure', worry:'unsure' };
const baseResult = {
  BIG5:{'개방성_백분위':50,'성실성_백분위':50,'외향성_백분위':50,'친화성_백분위':50,'신경성_백분위':50},
  '직업흥미유형':{'유형':'RIA','점수':{R:50,I:50,A:50,S:50,E:50,C:50}},
  gazeMetrics:{quality:'good',focus:'mid',exploration:'mid'}, depressionScreening:{band:'low'},
};
const cases = [
  [1,{energy:1},{gazeMetrics:{quality:'good',focus:'low',exploration:'mid'}}],
  [2,{moods:['low'],issue:'task'},{BIG5:{'성실성_백분위':25}}],
  [3,{issue:'career'},{BIG5:{'개방성_백분위':80,'외향성_백분위':80}}],
  [4,{moods:['anxious'],issue:'relationship'},{BIG5:{'신경성_백분위':80}}],
  [5,{issue:'relationship'},{BIG5:{'외향성_백분위':25},'직업흥미유형':{'점수':{S:25}}}],
  [6,{issue:'growth',energy:5},{gazeMetrics:{exploration:'high'}}],
  [7,{moods:['tense'],issue:'change'},{BIG5:{'개방성_백분위':25}}],
  [8,{moods:['low'],energy:1},{depressionScreening:{band:'borderline'}}],
  [9,{moods:['low'],energy:3},{}],
  [10,{issue:'none',energy:1},{}],
  [11,{expectation:'yes',worry:'no',energy:1},{}],
  [12,{expectation:'no',worry:'no'},{depressionScreening:{band:'borderline'}}],
  [13,{expectation:'yes',worry:'yes',issue:'career'},{}],
  [14,{worry:'yes',issue:'relationship'},{BIG5:{'친화성_백분위':80}}],
  [15,{worry:'yes',issue:'task'},{BIG5:{'성실성_백분위':80}}],
  [16,{expectation:'yes'},{BIG5:{'개방성_백분위':80},'직업흥미유형':{'점수':{I:80}}}],
  [17,{expectation:'no',worry:'no',energy:1},{}],
  [18,{expectation:'yes',worry:'yes'},{BIG5:{'신경성_백분위':80}}],
];
assert.equal(RULES.length,18);
for (const [id,checkinPatch,resultPatch] of cases) {
  const checkin = {...baseCheckin,...checkinPatch};
  const result = structuredClone(baseResult);
  for (const [key,value] of Object.entries(resultPatch)) result[key] = {...result[key],...value};
  if (resultPatch.BIG5) result.BIG5={...baseResult.BIG5,...resultPatch.BIG5};
  if (resultPatch['직업흥미유형']) result['직업흥미유형']={...baseResult['직업흥미유형'],...resultPatch['직업흥미유형'],점수:{...baseResult['직업흥미유형'].점수,...resultPatch['직업흥미유형'].점수}};
  if (resultPatch.gazeMetrics) result.gazeMetrics={...baseResult.gazeMetrics,...resultPatch.gazeMetrics};
  const output=analyze(checkin,result);
  assert.ok(output.matched.some(item=>item.id===id),`rule ${id} did not match`);
}
const noScreen = structuredClone(baseResult);
noScreen.depressionScreening = {};
noScreen.EARP = 85; // A number without a documented band is not a clinical threshold.
const unknown=analyze({...baseCheckin,moods:['low'],energy:1,expectation:'no',worry:'no'},noScreen);
assert.ok(!unknown.matched.some(item=>[8,12,17].includes(item.id)));
assert.ok(unknown.all.filter(item=>[8,12,17].includes(item.id)).every(item=>item.missing.includes('screening')));
for(const mood of ['happy','joyful','sad','thrilled','lonely','empty','depressed','overwhelmed']){
  assert.ok(analyze({...baseCheckin,moods:[mood]},baseResult).checkin.moods.includes(mood));
}
assert.ok(analyze({...baseCheckin,moods:['sad'],issue:'task'}, {...baseResult,BIG5:{...baseResult.BIG5,'성실성_백분위':25}}).matched.some(item=>item.id===2));
console.log('18 care combinations and missing-screening guard passed');

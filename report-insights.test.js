const assert = require('node:assert/strict');
const { consistency, careerMatrix, traitCare, jobRiasec, CARE_IDS } = require('./report-insights.js');
const fs = require('fs');
const path = require('path');

const big5 = (O, C, E, A, N) => ({ '개방성_백분위':O, '성실성_백분위':C, '외향성_백분위':E, '친화성_백분위':A, '신경성_백분위':N });
const SAMPLE = {
  MBTI:'ENFP', '직업흥미유형':{ '유형':'EAS' }, BIG5:big5(82, 47, 74, 68, 31),
  '직무적합도':[
    { '직업':'콘텐츠 기획자', '점수':'87.4' }, { '직업':'마케팅 전략가', '점수':'84.1' }, { '직업':'UX 디자이너', '점수':'81.9' },
    { '직업':'광고 크리에이터', '점수':'77.6' }, { '직업':'방송 PD', '점수':'74.8' }, { '직업':'데이터 분석가', '점수':'58.3' }, { '직업':'회계사', '점수':'46.1' },
  ],
};

/* 직무명 → RIASEC 추정 */
assert.deepEqual(jobRiasec('회계사'), ['C']);
assert.ok(jobRiasec('데이터 분석가').includes('I'));
assert.deepEqual(jobRiasec('알 수 없는 직무'), []);

/* 1) 일관성: ENFP × 개방 82 · 외향 74 · 친화 68 · 성실 47 */
const cs = consistency(SAMPLE);
const byPair = Object.fromEntries(cs.axes.map(a => [a.pair, a.verdict]));
assert.equal(byPair['E ↔ 외향성'], 'match');
assert.equal(byPair['N ↔ 개방성'], 'match');
assert.equal(byPair['F ↔ 친화성'], 'match');
assert.equal(byPair['P ↔ 성실성'], 'neutral');        // 47 은 중간대
assert.equal(byPair['E ↔ 외향성'], 'match');
assert.ok(cs.score >= 75 && cs.level.key === 'clear');
/* 반대 방향이면 '다른 면' */
const differ = consistency({ MBTI:'ISTJ', BIG5:big5(85, 20, 90, 80, 50) });
assert.ok(differ.axes.every(a => a.verdict === 'differ'));
assert.equal(differ.level.key, 'multi');
/* 데이터가 없으면 null — 없는 값을 0 으로 만들지 않는다 */
assert.equal(consistency({}), null);
assert.equal(consistency({ MBTI:'ENFP' }), null);

/* 2) 적성 × 흥미 매트릭스 (중앙값 = 77.6) */
const mx = careerMatrix(SAMPLE);
const names = k => mx.quad[k].map(j => j.name);
assert.ok(names('core').includes('콘텐츠 기획자'));
assert.ok(names('later').includes('회계사'));
assert.ok(names('interest').includes('방송 PD'));
assert.equal(careerMatrix({ '직무적합도':SAMPLE['직무적합도'] }), null); // 흥미 코드 없음

/* 3) 특성 조합 케어 */
assert.deepEqual(traitCare({ BIG5:big5(50, 30, 30, 50, 80) }).map(c => c.id), ['worryDelay', 'quietStress']);
assert.deepEqual(traitCare({ BIG5:big5(50, 50, 50, 50, 50) }).map(c => c.id), ['balanced']);
assert.equal(traitCare({ BIG5:big5(50, 50, 50, 50, null) }), null);
assert.ok(traitCare({ BIG5:big5(90, 20, 90, 20, 90) }).length <= 3);

/* 케어 패턴 id 는 carebot 서버 화이트리스트와 일치해야 한다 */
const py = fs.readFileSync(path.join(__dirname, 'api', 'care-preview.py'), 'utf8');
CARE_IDS.forEach(id => assert.ok(py.includes(`"${id}":`), `TRAIT_PATTERNS 에 ${id} 없음`));

console.log('report insights: consistency · matrix · trait care passed');

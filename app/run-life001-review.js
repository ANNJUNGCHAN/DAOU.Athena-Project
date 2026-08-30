'use strict';

// LIFE-001 수동 검수 전용 진입점. 사용자의 실제 Athena 프로필을 읽거나 쓰지 않고,
// 호출자가 만든 빈 userData 폴더에서 현재 main.js와 동일한 앱 창을 연다.
const path = require('path');
const { app } = require('electron');

const reviewProfile = process.env.ATHENA_USERDATA_DIR;
if (!reviewProfile) {
  throw new Error('ATHENA_USERDATA_DIR is required for the LIFE-001 review app');
}

app.setPath('userData', path.resolve(reviewProfile));
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

require('./main');

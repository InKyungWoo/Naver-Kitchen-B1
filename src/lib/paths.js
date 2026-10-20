/**
 * 프로젝트 루트 기준 런타임 파일 경로 (스크립트 위치와 무관하게 한 곳에서 관리)
 */

const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

module.exports = {
  ROOT,
  USER_DATA_DIR: path.join(ROOT, ".browser-profile"),
  LOCK_PATH: path.join(ROOT, ".browser-profile.lock"),
  PROCESSED_FILE: path.join(ROOT, ".processed-posts.json"),
  ALERT_STATE_FILE: path.join(ROOT, ".alert-state.json"),
};

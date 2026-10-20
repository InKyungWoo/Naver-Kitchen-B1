/**
 * 동일한 Puppeteer userDataDir을 쓰는 스크립트가 동시에 실행되면
 * 프로필이 깨지거나 로그인 세션이 손상될 수 있어, 파일 락으로 직렬화
 */

const fs = require("fs");
const { LOCK_PATH } = require("./paths");

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function tryRemoveStaleLock() {
  try {
    const raw = fs.readFileSync(LOCK_PATH, "utf8");
    const pid = parseInt(String(raw).trim(), 10);
    if (!isPidAlive(pid)) {
      fs.unlinkSync(LOCK_PATH);
      return true;
    }
  } catch (e) {
    if (e.code === "ENOENT") return false;
    try {
      fs.unlinkSync(LOCK_PATH);
      return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

function tryAcquireOnce() {
  try {
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeSync(fd, String(process.pid));
    return fd;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (tryRemoveStaleLock()) {
      return tryAcquireOnce();
    }
    return null;
  }
}

/**
 * @param {{ waitMs?: number, pollMs?: number }} [opts]
 * @returns {Promise<number|null>} 파일 디스크립터 또는 획득 실패 시 null
 */
async function acquireBrowserProfileLock(opts = {}) {
  const waitMs = opts.waitMs ?? 0;
  const pollMs = opts.pollMs ?? 500;
  const deadline = Date.now() + waitMs;

  while (true) {
    const fd = tryAcquireOnce();
    if (fd !== null) return fd;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}

function releaseBrowserProfileLock(fd) {
  if (fd == null) return;
  try {
    fs.closeSync(fd);
  } catch (_) {}
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch (_) {}
}

module.exports = {
  acquireBrowserProfileLock,
  releaseBrowserProfileLock,
};

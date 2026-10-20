/**
 * 처리된(슬랙 전송 완료/건너뛴) 게시물 ID 기록
 * 메일 체크와 직접 체크가 같은 파일을 공유해 중복 전송을 막기
 */

const fs = require("fs");
const { PROCESSED_FILE } = require("./paths");

// 최근 100개만 유지
const MAX_RECORDS = 100;

function loadProcessedPosts() {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      return JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf8"));
    }
  } catch (e) {
    // 파일이 없거나 파싱 에러
  }
  return [];
}

function saveProcessedPosts(posts) {
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(posts.slice(-MAX_RECORDS), null, 2));
}

function markProcessed(postId) {
  if (!postId) return;
  const posts = loadProcessedPosts();
  if (!posts.includes(postId)) {
    posts.push(postId);
    saveProcessedPosts(posts);
  }
}

module.exports = {
  loadProcessedPosts,
  markProcessed,
};

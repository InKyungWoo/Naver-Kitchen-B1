/**
 * 특정 게시물 URL을 슬랙으로 전송
 *
 * 사용법: npm run send -- <URL>
 * 예시: npm run send -- https://www.band.us/band/47113445/post/926902987
 */

const { USER_DATA_DIR } = require("./lib/paths");
const { acquireBrowserProfileLock, releaseBrowserProfileLock } = require("./lib/browser-lock");
const { launchBrowser, closeBrowser } = require("./lib/browser-session");
const { scrapePost } = require("./lib/band-post");
const { sendToSlack } = require("./lib/slack");
require("dotenv").config();

const url = process.argv[2];

if (!url) {
  console.log("❌ URL을 입력해주세요");
  console.log("사용법: npm run send -- <URL>");
  console.log("예시: npm run send -- https://www.band.us/band/밴드번호/post/게시물번호");
  process.exit(1);
}

async function sendPost() {
  const lockFd = await acquireBrowserProfileLock({ waitMs: 300000 });
  if (lockFd === null) {
    console.log("❌ 브라우저 프로필을 다른 작업이 오래 사용 중입니다. 잠시 후 다시 시도하세요.");
    process.exit(1);
  }

  console.log("🌐 브라우저 시작...");
  let browser;
  try {
    browser = await launchBrowser(USER_DATA_DIR);
    console.log(`📍 페이지 로딩: ${url}`);
    const { post, reason } = await scrapePost(browser, url);

    if (reason === "login") {
      console.log("❌ 로그인 필요 - npm run login 먼저 실행하세요");
      return;
    }
    if (reason === "deleted") {
      console.log("❌ 삭제되었거나 찾을 수 없는 게시물입니다");
      return;
    }
    if (!post) {
      console.log(`❌ 게시물 내용을 가져오지 못했습니다 (${reason})`);
      return;
    }

    console.log(`📄 내용: ${post.content.substring(0, 50)}...`);
    console.log("📤 슬랙으로 전송 중...");
    await sendToSlack(post);
    console.log("✅ 전송 완료!");
  } catch (error) {
    console.error("❌ 에러:", error.message);
  } finally {
    try {
      if (browser) {
        await closeBrowser(browser);
        console.log("🔒 브라우저 종료");
      }
    } finally {
      releaseBrowserProfileLock(lockFd);
    }
  }
}

sendPost();

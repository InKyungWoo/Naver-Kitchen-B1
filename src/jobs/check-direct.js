/**
 * 밴드 직접 체크 → 슬랙 전송 (코어타임용)
 *
 * 이메일 알림을 기다리지 않고 직접 밴드 피드를 확인하여
 * 새 게시물이 있으면 슬랙으로 전송합니다.
 *
 * 코어타임(점심/저녁 시간대)에 10분 간격으로 실행하여
 * 메일 지연 문제를 해결합니다.
 *
 * 사용법: node src/check-direct.js
 */

const fs = require("fs");
const { USER_DATA_DIR } = require("../lib/paths");
const { acquireBrowserProfileLock, releaseBrowserProfileLock } = require("../lib/browser-lock");
const { sendErrorAlert } = require("../lib/error-alert");
const { launchBrowser, watchDialogs, detectPageState, closeBrowser } = require("../lib/browser-session");
const { extractPostId, scrapePost } = require("../lib/band-post");
const { sendToSlack } = require("../lib/slack");
const { loadProcessedPosts, markProcessed } = require("../lib/processed-posts");
require("dotenv").config();

const BAND_URL = process.env.BAND_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

async function main() {
  console.log("🔍 밴드 직접 체크 시작...", new Date().toLocaleString("ko-KR"));
  console.log("");

  if (!BAND_URL || !SLACK_WEBHOOK_URL) {
    console.error("❌ 필수 환경변수가 설정되지 않았습니다.");
    console.log("   BAND_URL, SLACK_WEBHOOK_URL");
    process.exit(1);
  }

  if (!fs.existsSync(USER_DATA_DIR)) {
    console.error("❌ 브라우저 프로필이 없습니다.");
    console.log("   먼저 npm run login을 실행하여 로그인하세요.");
    process.exit(1);
  }

  const lockFd = await acquireBrowserProfileLock({ waitMs: 60000 });
  if (lockFd === null) {
    console.log("⏭️ 브라우저 프로필이 다른 작업에 사용 중입니다. 이번 실행은 건너뜁니다.");
    return;
  }

  let browser;
  try {
    browser = await launchBrowser(USER_DATA_DIR);

    console.log("🌐 밴드 피드 접속 중...");
    const page = await browser.newPage();
    const feedDialogState = watchDialogs(page);

    // 밴드 피드 페이지 접속
    await page.goto(BAND_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 로그인 만료 확인 (리다이렉트 또는 "멤버만 볼 수 있습니다" 화면)
    if ((await detectPageState(page, feedDialogState)) === "login") {
      console.log("⚠️ 로그인이 필요합니다. npm run login 실행 필요");
      await sendErrorAlert("밴드 직접 체크: 로그인 세션 만료. npm run login 실행 필요.", { alertKey: "login" });
      return;
    }

    // 피드에서 게시물 링크들 추출
    const postLinks = await page.evaluate(() => {
      const links = [];
      const seenIds = new Set();

      // 게시물 링크 찾기 (다양한 선택자 시도)
      const selectors = ['a[href*="/post/"]', ".postWrap a", ".cPost a", '[class*="post"] a'];

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((a) => {
          const href = a.href;
          if (href && href.includes("/post/")) {
            // URL에서 post ID 추출
            const match = href.match(/\/band\/\d+\/post\/(\d+)/);
            if (match && !seenIds.has(match[1])) {
              seenIds.add(match[1]);
              // 쿼리스트링·댓글 경로(/comment/N) 제거한 게시물 URL
              const cleanUrl = new URL(href).origin + match[0];
              links.push(cleanUrl);
            }
          }
        });
      });

      return links;
    });

    console.log(`   📋 피드에서 게시물 ${postLinks.length}개 발견`);

    if (postLinks.length === 0) {
      console.log("📭 피드에 게시물이 없습니다.");
      return;
    }

    // 처리된 게시물 목록 로드
    const processedPosts = loadProcessedPosts();

    // 새 게시물 필터링 (상단 고정 공지 등 옛 게시물 제외: 처리된 최신 ID보다 큰 것만)
    const newestProcessedId = processedPosts.reduce((max, id) => Math.max(max, Number(id) || 0), 0);
    const newLinks = postLinks.filter((link) => {
      const postId = extractPostId(link);
      return postId && !processedPosts.includes(postId) && Number(postId) > newestProcessedId;
    });

    if (newLinks.length === 0) {
      console.log("✅ 새 게시물 없음 (모두 처리됨)");
      return;
    }

    console.log(`🆕 새 게시물 ${newLinks.length}개 발견`);

    // 가장 최신 게시물 1개만 처리 (첫 번째가 가장 최신)
    const latestLink = newLinks[0];
    const latestPostId = extractPostId(latestLink);
    const latestProcessedPosts = loadProcessedPosts();
    if (latestPostId && latestProcessedPosts.includes(latestPostId)) {
      console.log("⏭️ 락 대기 중 이미 처리된 게시물입니다. 전송 건너뜀");
      return;
    }
    console.log(`\n📍 최신 게시물 스크래핑: ${latestLink}`);

    const { post, reason } = await scrapePost(browser, latestLink);

    if (post && post.content && post.content.length > 10) {
      console.log("📤 슬랙으로 전송 중...");
      await sendToSlack(post);
      console.log("✅ 전송 완료!");

      markProcessed(latestPostId);
    } else if (reason === "deleted") {
      console.log("🗑️ 삭제된 게시물입니다. 처리 완료로 기록하고 건너뜁니다.");
      markProcessed(latestPostId);
    } else if (reason === "login") {
      console.log("⚠️ 로그인이 필요합니다");
      await sendErrorAlert("로그인 세션이 만료되었습니다. npm run login 실행 필요.", { alertKey: "login" });
    } else if (reason === "timeout") {
      console.log("⚠️ 페이지 로딩 시간 초과. 다음 실행 때 재시도합니다.");
    } else {
      console.log(`⚠️ 게시물 스크래핑 실패 (${reason || "unknown"})`);
    }

    console.log("\n🎉 완료!");
  } catch (error) {
    console.error("❌ 에러 발생:", error.message);
    await sendErrorAlert(`밴드 직접 체크 오류: ${error.message}`, { alertKey: "check-direct-error" });
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

main().catch(async (err) => {
  console.error("❌ 치명적 오류:", err.message);
  await sendErrorAlert(err.message, { alertKey: "fatal" });
  process.exit(1);
});

/**
 * 메일 체크 → 밴드 스크래핑 → 슬랙 전송 (로컬용)
 *
 * 1. IMAP으로 읽지 않은 밴드 알림 메일 체크
 * 2. 메일에서 게시물 링크 추출
 * 3. 브라우저 프로필로 해당 게시물 스크래핑
 * 4. 슬랙으로 전송
 *
 * 사용법: npm run check
 */

const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const { USER_DATA_DIR } = require("./lib/paths");
const { acquireBrowserProfileLock, releaseBrowserProfileLock } = require("./lib/browser-lock");
const { sendErrorAlert } = require("./lib/error-alert");
const { launchBrowser, closeBrowser } = require("./lib/browser-session");
const { extractPostId, scrapePost } = require("./lib/band-post");
const { sendToSlack } = require("./lib/slack");
const { loadProcessedPosts, markProcessed } = require("./lib/processed-posts");
require("dotenv").config();

const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

async function main() {
  console.log("🚀 밴드 체크 시작...", new Date().toLocaleString("ko-KR"));
  console.log("");

  // 환경변수 확인
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS || !SLACK_WEBHOOK_URL) {
    console.error("❌ 필수 환경변수가 설정되지 않았습니다.");
    console.log("   IMAP_HOST, IMAP_USER, IMAP_PASS, SLACK_WEBHOOK_URL");
    process.exit(1);
  }

  // 브라우저 프로필 확인
  if (!fs.existsSync(USER_DATA_DIR)) {
    console.error("❌ 브라우저 프로필이 없습니다.");
    console.log("   먼저 npm run login을 실행하여 로그인하세요.");
    process.exit(1);
  }

  try {
    // 1단계: 메일에서 밴드 링크 추출
    console.log("📧 메일 체크 중...");
    const bandLinks = await checkMailForBandLinks();

    if (bandLinks.length === 0) {
      console.log("📭 새로운 밴드 알림 메일이 없습니다.");
      console.log("✅ 완료");
      return;
    }

    console.log(`📬 새 밴드 링크 ${bandLinks.length}개 발견`);

    // 처리된 게시물 목록 로드
    const processedPosts = loadProcessedPosts();

    // 새 링크만 필터링
    const newLinks = bandLinks.filter((link) => {
      const postId = extractPostId(link);
      return postId && !processedPosts.includes(postId);
    });

    if (newLinks.length === 0) {
      console.log("⏭️ 모든 게시물이 이미 처리되었습니다.");
      console.log("✅ 완료");
      return;
    }

    // 🔥 가장 최신 게시물 1개만 처리 (마지막 링크가 가장 최신)
    const latestLink = newLinks[newLinks.length - 1];
    console.log(`🆕 최신 게시물 1개 처리 (총 ${newLinks.length}개 중)`);
    console.log("");

    // 2단계: 브라우저로 스크래핑 (다른 cron과 동시 실행 시 프로필 손상 방지)
    const lockFd = await acquireBrowserProfileLock({ waitMs: 120000 });
    if (lockFd === null) {
      console.log("⏭️ 브라우저 프로필이 다른 작업에 사용 중입니다. 이번 실행은 건너뜁니다.");
      return;
    }

    console.log("🌐 브라우저 시작...");
    let browser;
    try {
      browser = await launchBrowser(USER_DATA_DIR);

      const link = latestLink;
      const postId = extractPostId(link);
      const latestProcessedPosts = loadProcessedPosts();
      if (postId && latestProcessedPosts.includes(postId)) {
        console.log("⏭️ 락 대기 중 이미 처리된 게시물입니다. 전송 건너뜀");
        return;
      }
      console.log(`\n📍 게시물 스크래핑: ${link}`);

      const { post, reason } = await scrapePost(browser, link);

      if (post && post.content && post.content.length > 10) {
        // 슬랙 전송
        console.log("📤 슬랙으로 전송 중...");
        await sendToSlack(post);
        console.log("✅ 전송 완료!");
        markProcessed(postId);
      } else if (reason === "deleted") {
        console.log("🗑️ 삭제된 게시물입니다. 처리 완료로 기록하고 건너뜁니다.");
        markProcessed(postId);
      } else if (reason === "login") {
        console.log("⚠️ 로그인이 필요합니다");
        await sendErrorAlert("로그인 세션이 만료되었습니다. npm run login 실행 필요.", { alertKey: "login" });
      } else if (reason === "timeout") {
        console.log("⚠️ 페이지 로딩 시간 초과. 다음 실행 때 재시도합니다.");
      } else {
        console.log(`⚠️ 게시물 스크래핑 실패 (${reason || "unknown"})`);
      }
    } finally {
      try {
        if (browser) {
          await closeBrowser(browser);
          console.log("\n🔒 브라우저 종료");
        }
      } finally {
        releaseBrowserProfileLock(lockFd);
      }
    }

    console.log("\n🎉 모든 작업 완료!");
  } catch (error) {
    console.error("❌ 에러 발생:", error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * IMAP으로 밴드 알림 메일 체크
 */
function checkMailForBandLinks() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: IMAP_USER,
      password: IMAP_PASS,
      host: IMAP_HOST,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const bandLinks = [];

    imap.once("ready", () => {
      // Kitchen B1 폴더 열기
      imap.openBox("Kitchen B1", false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // 읽지 않은 BAND 메일 검색
        imap.search(["UNSEEN", ["FROM", "BAND"]], (err, results) => {
          if (err || !results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          console.log(`   📧 새 밴드 메일 ${results.length}개 발견`);

          const fetch = imap.fetch(results, { bodies: "", markSeen: true });
          let pending = results.length;

          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) {
                  pending--;
                  if (pending === 0) imap.end();
                  return;
                }

                // 메일 본문에서 밴드 링크 추출
                const text = (parsed.text || "") + (parsed.html || "");
                const linkMatches = text.match(/https?:\/\/(www\.)?band\.us\/band\/\d+\/post\/\d+/g);

                if (linkMatches) {
                  linkMatches.forEach((link) => {
                    if (!bandLinks.includes(link)) {
                      bandLinks.push(link);
                    }
                  });
                }

                pending--;
                if (pending === 0) imap.end();
              });
            });
          });

          fetch.once("error", (err) => {
            imap.end();
            reject(err);
          });

          fetch.once("end", () => {});
        });
      });
    });

    imap.once("error", reject);
    imap.once("end", () => resolve(bandLinks));
    imap.connect();
  });
}

// 실행
main().catch(async (err) => {
  console.error("❌ 치명적 오류:", err.message);
  await sendErrorAlert(err.message, { alertKey: "fatal" });
  process.exit(1);
});

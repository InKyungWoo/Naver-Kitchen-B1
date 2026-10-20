/**
 * IMAP 메일 연결 테스트 스크립트
 *
 * 밴드 알림 메일이 정상적으로 수신되는지 테스트합니다.
 *
 * 사용법: npm run test-mail
 */

const Imap = require("imap");
const { simpleParser } = require("mailparser");
require("dotenv").config();

const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;

async function testMail() {
  console.log("📧 IMAP 메일 테스트 시작...\n");

  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
    console.error("❌ 환경변수가 설정되지 않았습니다.");
    console.log("\n.env 파일에 다음을 설정하세요:");
    console.log("IMAP_HOST=imap.worksmobile.com (또는 imap.naver.com)");
    console.log("IMAP_USER=your_email@domain.com");
    console.log("IMAP_PASS=your_password");
    process.exit(1);
  }

  console.log(`📍 서버: ${IMAP_HOST}`);
  console.log(`👤 계정: ${IMAP_USER}`);
  console.log("");

  const imap = new Imap({
    user: IMAP_USER,
    password: IMAP_PASS,
    host: IMAP_HOST,
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });

  imap.once("ready", () => {
    console.log("✅ IMAP 연결 성공!\n");

    imap.openBox("INBOX", true, (err, box) => {
      if (err) {
        console.error("❌ 받은편지함 열기 실패:", err.message);
        imap.end();
        return;
      }

      console.log(`📬 받은편지함 정보:`);
      console.log(`   - 총 메일 수: ${box.messages.total}`);
      console.log(`   - 읽지 않은 메일: ${box.messages.unseen}`);
      console.log("");

      // 최근 7일간의 밴드 관련 메일 검색
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      console.log("🔍 밴드 관련 메일 검색 중 (최근 7일)...\n");

      imap.search(
        [
          ["SINCE", weekAgo],
          ["OR", ["FROM", "band"], ["OR", ["SUBJECT", "밴드"], ["SUBJECT", "BAND"]]],
        ],
        (err, results) => {
          if (err) {
            console.error("❌ 검색 실패:", err.message);
            imap.end();
            return;
          }

          if (!results || results.length === 0) {
            console.log("📭 밴드 관련 메일이 없습니다.\n");
            console.log("💡 확인사항:");
            console.log("   1. 밴드 앱에서 이메일 알림이 켜져 있나요?");
            console.log("   2. 밴드 설정 > 알림 > 이메일로 알림 받기");
            console.log("   3. 해당 밴드에 새 글이 올라왔나요?");
            imap.end();
            return;
          }

          console.log(`📬 밴드 관련 메일 ${results.length}개 발견!\n`);

          // 최근 5개만 상세 조회
          const recentResults = results.slice(-5);
          let processedCount = 0;

          const fetch = imap.fetch(recentResults, { bodies: "", struct: true });

          fetch.on("message", (msg, seqno) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;

                processedCount++;
                console.log(`━━━━━━━━━━ 메일 #${processedCount} ━━━━━━━━━━`);
                console.log(`📌 제목: ${parsed.subject || "(제목 없음)"}`);
                console.log(`👤 발신자: ${parsed.from?.text || "알 수 없음"}`);
                console.log(`📅 날짜: ${parsed.date?.toLocaleString("ko-KR") || "알 수 없음"}`);

                // 밴드 링크 추출
                const text = (parsed.text || "") + (parsed.html || "");
                const bandLinks = text.match(/https?:\/\/band\.us\/band\/\d+\/post\/\d+/g) || [];

                if (bandLinks.length > 0) {
                  console.log(`🔗 밴드 링크 발견:`);
                  bandLinks.forEach((link, i) => console.log(`   ${i + 1}. ${link}`));
                } else {
                  console.log(`🔗 밴드 링크: 없음`);
                  // 다른 형태의 밴드 링크 찾기
                  const altLinks = text.match(/https?:\/\/band\.us[^\s"<>]*/g) || [];
                  if (altLinks.length > 0) {
                    console.log(`   (다른 밴드 URL: ${altLinks[0]})`);
                  }
                }
                console.log("");
              });
            });
          });

          fetch.once("end", () => {
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log("\n✅ 메일 테스트 완료!");
            console.log("\n💡 다음 단계:");
            console.log("   1. 밴드 링크가 발견되면 연동 준비 완료");
            console.log("   2. crontab에서 npm run check(src/jobs/check-and-notify.js) 주기 실행");
            imap.end();
          });
        },
      );
    });
  });

  imap.once("error", (err) => {
    console.error("❌ IMAP 연결 에러:", err.message);
    console.log("\n💡 확인사항:");
    console.log("   - 이메일/비밀번호가 맞나요?");
    console.log("   - IMAP이 활성화되어 있나요? (메일 설정에서 확인)");
    console.log("   - 2단계 인증 사용 시 앱 비밀번호가 필요합니다.");

    if (IMAP_HOST.includes("worksmobile")) {
      console.log("\n📌 네이버웍스 IMAP 설정:");
      console.log("   1. 네이버웍스 > 설정 > 메일 > IMAP/POP3");
      console.log("   2. IMAP 사용 설정 켜기");
    } else if (IMAP_HOST.includes("naver")) {
      console.log("\n📌 네이버메일 IMAP 설정:");
      console.log("   1. 네이버메일 > 환경설정 > POP3/IMAP 설정");
      console.log("   2. IMAP 사용함 선택");
    }
  });

  imap.once("end", () => {
    console.log("\n🔒 IMAP 연결 종료");
  });

  imap.connect();
}

testMail();

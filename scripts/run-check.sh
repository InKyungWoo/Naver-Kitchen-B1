#!/bin/bash

# 프로젝트 디렉토리로 이동
cd /Users/rebuilderai/Desktop/github/naver-kitchen-b1

# Node.js로 메일 체크 및 슬랙 전송 실행
/usr/local/bin/node scripts/check-and-notify.js >> logs/cron.log 2>&1

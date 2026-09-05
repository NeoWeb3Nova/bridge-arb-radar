#!/usr/bin/env bash
cd "$(dirname "$0")"

# 境外接口可按需开启本地代理
# export HTTPS_PROXY=http://127.0.0.1:10808
# export HTTP_PROXY=http://127.0.0.1:10808

node --disable-warning=ExperimentalWarning server.js

# -*- coding: utf-8 -*-
"""연구 관리자 인증 export (터미널 전용 · 표준 라이브러리만):  py -3 tools/colab/export.py training/raw [--email <연구 관리자 이메일>]
비밀번호는 getpass 로 입력받아 이 프로세스 안에서만 쓰고, 토큰·비밀번호를 디스크에 쓰지 않습니다. 결과는 training/raw/sessions/*.json + index.json."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nlcolab.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(["export", *sys.argv[1:]]))

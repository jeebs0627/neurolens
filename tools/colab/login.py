# -*- coding: utf-8 -*-
"""연구 관리자 로그인 (터미널 전용 · 표준 라이브러리만 사용):  py -3 tools/colab/login.py <email>
비밀번호는 화면에 보이지 않고 저장되지 않습니다. 약 1시간짜리 세션 토큰만 training/.session.json 에 저장되며 export 뒤 삭제됩니다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nlcolab.login import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

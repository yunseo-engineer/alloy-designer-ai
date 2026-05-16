"""
run_pipeline.py
================
전체 파이프라인을 한 번에 실행한다.

순서:
0. filter_papers_hea.py      (papers/inbox 필터링 → papers/filtered/)
1. extract_paper.py --batch  (papers/filtered/hea 의 모든 PDF 추출)
2. validate.py               (data/extracted/ 검증 → data/validated/)
3. descriptor_calc.py        (descriptor 계산, validated/ 갱신)
4. build_dataset.py          (master_dataset.json + .csv 생성)
5. db_setup.py               (SQLite 로그 + 메타데이터 적재)

사용법:
    python scripts/run_pipeline.py
    python scripts/run_pipeline.py --skip-filter   # 필터링 건너뛰기
"""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
INBOX = ROOT / "papers" / "inbox"


def main():
    parser = argparse.ArgumentParser(description="HEA 전체 파이프라인 실행")
    parser.add_argument(
        "--skip-filter",
        action="store_true",
        help="필터링 단계 건너뛰기 (이미 filtered/hea/ 준비된 경우)",
    )
    args = parser.parse_args()

    steps = []

    if not args.skip_filter:
        steps.append((
            "논문 필터링",
            [sys.executable, str(SCRIPTS / "filter_papers_hea.py"), str(INBOX)],
        ))

    steps += [
        ("논문 추출",         [sys.executable, str(SCRIPTS / "extract_paper.py"), "--batch"]),
        ("데이터 검증",       [sys.executable, str(SCRIPTS / "validate.py")]),
        ("Descriptor 계산",   [sys.executable, str(SCRIPTS / "descriptor_calc.py")]),
        ("Master 데이터셋 빌드", [sys.executable, str(SCRIPTS / "build_dataset.py")]),
        ("DB 적재",           [sys.executable, str(SCRIPTS / "db_setup.py")]),
    ]

    for name, cmd in steps:
        print(f"\n{'='*60}\n  {name}\n{'='*60}")
        result = subprocess.run(cmd, cwd=str(ROOT))
        if result.returncode != 0:
            print(f"❌ {name} 실패. 파이프라인 중단.")
            sys.exit(1)

    print("\n🎉 전체 파이프라인 완료!")


if __name__ == "__main__":
    main()
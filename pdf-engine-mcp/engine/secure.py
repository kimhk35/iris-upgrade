"""engine/secure.py — 암호 걸기/풀기(AES-256 기본)."""
from __future__ import annotations

import os
from typing import Optional

from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as UAP

from .common import check_src, ensure_parent, open_reader


def encrypt(
    src_path: str,
    out_path: str,
    user_password: str,
    owner_password: Optional[str] = None,
    algorithm: str = "AES-256",
    allow_printing: bool = True,
    allow_copying: bool = True,
    password: Optional[str] = None,
) -> dict:
    """user_password=열람 암호, owner_password=권한 해제 암호.

    owner_password 를 생략했을 때: 인쇄·복사를 막는 경우에는 무작위 권한 암호를 만들어 결과에 돌려준다
    (열람 암호와 같으면 열람 암호만 아는 사람이 제한을 풀 수 있어 「인쇄·복사 금지」가 무의미 — P18 점검).
    제한이 없으면 예전처럼 열람 암호와 같다. 알고리즘은 AES 만 받는다(RC4 는 약함).
    password는 이미 암호화된 원본을 열 때의 기존 암호다.
    """
    if not user_password:
        raise ValueError("user_password가 비었습니다.")
    if algorithm not in ("AES-256", "AES-256-R5", "AES-128"):
        raise ValueError(f"암호화 방식은 AES-256 또는 AES-128 만 쓸 수 있습니다(받은 값: {algorithm}).")
    generated = None
    if not owner_password and (not allow_printing or not allow_copying):
        import secrets
        owner_password = generated = secrets.token_urlsafe(18)
    reader = open_reader(src_path, password)
    writer = PdfWriter(clone_from=reader)
    perms = UAP.all()
    if not allow_printing:
        perms &= ~(UAP.PRINT | UAP.PRINT_TO_REPRESENTATION)
    if not allow_copying:
        perms &= ~UAP.EXTRACT
    writer.encrypt(
        user_password=user_password,
        owner_password=owner_password or user_password,
        algorithm=algorithm,
        permissions_flag=perms,
    )
    out = ensure_parent(out_path)
    with open(out, "wb") as f:
        writer.write(f)
    result = {"out_path": out, "algorithm": algorithm,
              "allow_printing": allow_printing, "allow_copying": allow_copying}
    if generated:
        result["owner_password"] = generated
        result["note"] = "권한 해제 암호를 따로 주지 않아 무작위로 만들었습니다. 인쇄·복사 제한을 나중에 풀려면 이 암호가 필요하니 보관하세요."
    return result


def decrypt(src_path: str, out_path: str, password: str) -> dict:
    src = check_src(src_path)
    probe = PdfReader(src)
    if not probe.is_encrypted:
        raise ValueError("이 PDF는 암호화되어 있지 않습니다.")
    reader = open_reader(src, password)
    writer = PdfWriter(clone_from=reader)
    out = ensure_parent(out_path)
    with open(out, "wb") as f:
        writer.write(f)
    return {"out_path": out, "pages": len(writer.pages), "decrypted": True,
            "note": "사용자가 암호를 아는 파일의 잠금 해제 용도입니다."}

# ruff: noqa: E501, I001


"""Generated Pydantic models. Do not edit; run backend/scripts/generate_api.py."""


from __future__ import annotations





from typing import Any, ClassVar





from pydantic import BaseModel, ConfigDict, Field


class Tr00RequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr00Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '00'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n\n0:기존유지안함 1:기존유지(Default)\n\n0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n\n해지(REMOVE)시 값 불필요')
    data: list[Tr00RequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr00ResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_9201: str | None = Field(None, alias='9201', description='계좌번호 — 고유 계좌번호 10자리')
    f_9203: str | None = Field(None, alias='9203', description='주문번호 — 주문번호 7자리')
    f_9205: str | None = Field(None, alias='9205', description='관리자사번')
    f_9001: str | None = Field(None, alias='9001', description='종목코드,업종코드')
    f_912: str | None = Field(None, alias='912', description='주문업무분류')
    f_913: str | None = Field(None, alias='913', description='주문상태 — 접수, 체결, 확인, 취소, 거부')
    f_302: str | None = Field(None, alias='302', description='종목명')
    f_900: str | None = Field(None, alias='900', description='주문수량 — 단위: 1주')
    f_901: str | None = Field(None, alias='901', description='주문가격 — 단위: 원')
    f_902: str | None = Field(None, alias='902', description='미체결수량 — 단위: 1주')
    f_903: str | None = Field(None, alias='903', description='체결누계금액 — 단위: 원')
    f_904: str | None = Field(None, alias='904', description="원주문번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    f_905: str | None = Field(None, alias='905', description='주문구분 — "+/-", 매도, 매수, 매도정정, 매수정정, 매수취소, 매도취소\n\n\n※ 영웅문4에서 적색으로 표기되어있으면 +가, 청색으로 표기되어있으면 -가 앞에 기재됩니다')
    f_906: str | None = Field(None, alias='906', description='매매구분 — 보통, 시장가, 조건부지정가, 최유리지정가, 최우선지정가, 보통(IOC), 시장가(IOC), 최유리(IOC), 보통(FOK), 시장가(FOK), 최유리(FOK), 스톰지정가, 중간가, 중간가(IOC), 중간가(FOK), 장전시간외, 장후시간외, 시간외대량, 시간외바스켓, 시간외자사주, 시간외단일가')
    f_907: str | None = Field(None, alias='907', description='매도수구분 — 1:매도, 2:매수')
    f_908: str | None = Field(None, alias='908', description='주문/체결시간 — HHmmss')
    f_909: str | None = Field(None, alias='909', description='체결번호')
    f_910: str | None = Field(None, alias='910', description='체결가')
    f_911: str | None = Field(None, alias='911', description='체결량')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_27: str | None = Field(None, alias='27', description='(최우선)매도호가 — 단위: 원, 부호가 포함된 숫자')
    f_28: str | None = Field(None, alias='28', description='(최우선)매수호가 — 단위: 원, 부호가 포함된 숫자')
    f_914: str | None = Field(None, alias='914', description='단위체결가')
    f_915: str | None = Field(None, alias='915', description='단위체결량')
    f_938: str | None = Field(None, alias='938', description='당일매매수수료')
    f_939: str | None = Field(None, alias='939', description='당일매매세금')
    f_919: str | None = Field(None, alias='919', description='거부사유')
    f_920: str | None = Field(None, alias='920', description='화면번호 — HTS화면번호')
    f_921: str | None = Field(None, alias='921', description='터미널번호')
    f_922: str | None = Field(None, alias='922', description='신용구분 — 실시간 체결용')
    f_923: str | None = Field(None, alias='923', description='대출일 — 실시간 체결용')
    f_10010: str | None = Field(None, alias='10010', description='시간외단일가_현재가')
    f_2134: str | None = Field(None, alias='2134', description='거래소구분 — 0:통합,1:KRX,2:NXT')
    f_2135: str | None = Field(None, alias='2135', description='거래소구분명 — 통합,KRX,NXT')
    f_2136: str | None = Field(None, alias='2136', description='SOR여부 — Y,N')


class Tr00Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '00'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr00ResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr04RequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr04Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '04'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n \n0:기존유지안함 1:기존유지(Default)\n\n0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n\n해지(REMOVE)시 값 불필요')
    data: list[Tr04RequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr04ResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_9201: str | None = Field(None, alias='9201', description='계좌번호 — 고유 계좌번호 10자리')
    f_9001: str | None = Field(None, alias='9001', description='종목코드,업종코드')
    f_917: str | None = Field(None, alias='917', description='신용구분')
    f_916: str | None = Field(None, alias='916', description='대출일 — YYYYMMDD')
    f_302: str | None = Field(None, alias='302', description='종목명')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_930: str | None = Field(None, alias='930', description='보유수량 — 단위: 1주')
    f_931: str | None = Field(None, alias='931', description='매입단가 — 단위: 원')
    f_932: str | None = Field(None, alias='932', description='총매입가(당일누적) — 단위: 원')
    f_933: str | None = Field(None, alias='933', description='주문가능수량 — 단위: 1주')
    f_945: str | None = Field(None, alias='945', description='당일순매수량 — 단위: 1주')
    f_946: str | None = Field(None, alias='946', description='매도/매수구분 — 계약,주')
    f_950: str | None = Field(None, alias='950', description='당일총매도손익')
    f_951: str | None = Field(None, alias='951', description='Extra Item')
    f_27: str | None = Field(None, alias='27', description='(최우선)매도호가 — 단위: 원, 부호가 포함된 숫자')
    f_28: str | None = Field(None, alias='28', description='(최우선)매수호가 — 단위: 원, 부호가 포함된 숫자')
    f_307: str | None = Field(None, alias='307', description='기준가 — 단위: 원')
    f_8019: str | None = Field(None, alias='8019', description='손익률(실현손익) — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_957: str | None = Field(None, alias='957', description='신용금액')
    f_958: str | None = Field(None, alias='958', description='신용이자')
    f_918: str | None = Field(None, alias='918', description='만기일 — YYYYMMDD')
    f_990: str | None = Field(None, alias='990', description='당일실현손익(유가)')
    f_991: str | None = Field(None, alias='991', description='당일실현손익율(유가)')
    f_992: str | None = Field(None, alias='992', description='당일실현손익(신용)')
    f_993: str | None = Field(None, alias='993', description='당일실현손익율(신용)')
    f_959: str | None = Field(None, alias='959', description='담보대출수량')
    f_924: str | None = Field(None, alias='924', description='Extra Item')


class Tr04Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '04'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr04ResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0ARequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0ARequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0A'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n\n0:기존유지안함 1:기존유지(Default)\n\n0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n\n해지(REMOVE)시 값 불필요')
    data: list[Tr0ARequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0AResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_27: str | None = Field(None, alias='27', description='(최우선)매도호가 — 단위: 원, 부호가 포함된 숫자')
    f_28: str | None = Field(None, alias='28', description='(최우선)매수호가 — 단위: 원, 부호가 포함된 숫자')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_14: str | None = Field(None, alias='14', description='누적거래대금 — 단위: 백만원')
    f_16: str | None = Field(None, alias='16', description='시가 — 단위: 원, 부호가 포함된 숫자')
    f_17: str | None = Field(None, alias='17', description='고가 — 단위: 원, 부호가 포함된 숫자')
    f_18: str | None = Field(None, alias='18', description='저가 — 단위: 원, 부호가 포함된 숫자')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    f_26: str | None = Field(None, alias='26', description='전일거래량대비(계약,주) — 단위: 1주, 부호가 포함된 숫자')
    f_29: str | None = Field(None, alias='29', description='거래대금증감 — 단위: 원, 부호가 포함된 숫자')
    f_30: str | None = Field(None, alias='30', description='전일거래량대비(비율) — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_31: str | None = Field(None, alias='31', description='거래회전율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_32: str | None = Field(None, alias='32', description='거래비용')
    f_311: str | None = Field(None, alias='311', description='시가총액(억) — 단위: 억원')
    f_567: str | None = Field(None, alias='567', description='상한가발생시간 — HHmmss')
    f_568: str | None = Field(None, alias='568', description='하한가발생시간 — HHmmss')


class Tr0AResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0A'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지(등록,해지시에만 값 전송,데이터 실시간 수신시 미전송)')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0AResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0BRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0BRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0B'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0BRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0BResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0B,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_27: str | None = Field(None, alias='27', description='(최우선)매도호가 — 단위: 원, 부호가 포함된 숫자')
    f_28: str | None = Field(None, alias='28', description='(최우선)매수호가 — 단위: 원, 부호가 포함된 숫자')
    f_15: str | None = Field(None, alias='15', description='거래량 — +는 매수체결,-는 매도체결')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_14: str | None = Field(None, alias='14', description='누적거래대금 — 단위: 백만원')
    f_16: str | None = Field(None, alias='16', description='시가 — 단위: 원, 부호가 포함된 숫자')
    f_17: str | None = Field(None, alias='17', description='고가 — 단위: 원, 부호가 포함된 숫자')
    f_18: str | None = Field(None, alias='18', description='저가 — 단위: 원, 부호가 포함된 숫자')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    f_26: str | None = Field(None, alias='26', description='전일거래량대비(계약,주) — 단위: 1주, 부호가 포함된 숫자')
    f_29: str | None = Field(None, alias='29', description='거래대금증감 — 단위: 원, 부호가 포함된 숫자')
    f_30: str | None = Field(None, alias='30', description='전일거래량대비(비율) — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_31: str | None = Field(None, alias='31', description='거래회전율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_32: str | None = Field(None, alias='32', description='거래비용')
    f_228: str | None = Field(None, alias='228', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_311: str | None = Field(None, alias='311', description='시가총액(억)')
    f_290: str | None = Field(None, alias='290', description='장구분 — 1: 장전 시간외 , 2: 장중 , 3: 장후 시간외')
    f_691: str | None = Field(None, alias='691', description='K.O 접근도')
    f_567: str | None = Field(None, alias='567', description='상한가발생시간 — HHmmss')
    f_568: str | None = Field(None, alias='568', description='하한가발생시간 — HHmmss')
    f_851: str | None = Field(None, alias='851', description='전일 동시간 거래량 비율')
    f_1890: str | None = Field(None, alias='1890', description='시가시간')
    f_1891: str | None = Field(None, alias='1891', description='고가시간')
    f_1892: str | None = Field(None, alias='1892', description='저가시간')
    f_1030: str | None = Field(None, alias='1030', description='매도체결량')
    f_1031: str | None = Field(None, alias='1031', description='매수체결량')
    f_1032: str | None = Field(None, alias='1032', description='매수비율')
    f_1071: str | None = Field(None, alias='1071', description='매도체결건수')
    f_1072: str | None = Field(None, alias='1072', description='매수체결건수')
    f_1313: str | None = Field(None, alias='1313', description='순간거래대금')
    f_1315: str | None = Field(None, alias='1315', description='매도체결량_단건')
    f_1316: str | None = Field(None, alias='1316', description='매수체결량_단건')
    f_1314: str | None = Field(None, alias='1314', description='순매수체결량')
    f_1497: str | None = Field(None, alias='1497', description='CFD증거금')
    f_1498: str | None = Field(None, alias='1498', description='유지증거금')
    f_620: str | None = Field(None, alias='620', description='당일거래평균가')
    f_732: str | None = Field(None, alias='732', description='CFD거래비용')
    f_852: str | None = Field(None, alias='852', description='대주거래비용')
    f_9081: str | None = Field(None, alias='9081', description='거래소구분')


class Tr0BResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0B'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0BResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0CRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0CRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0C'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0CRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0CResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_27: str | None = Field(None, alias='27', description='(최우선)매도호가 — 단위: 원, 부호가 포함된 숫자')
    f_28: str | None = Field(None, alias='28', description='(최우선)매수호가 — 단위: 원, 부호가 포함된 숫자')


class Tr0CResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0C'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0CResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0DRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0DRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0D'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0DRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0DResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_21: str | None = Field(None, alias='21', description='호가시간 — HHmmss')
    f_41: str | None = Field(None, alias='41', description='매도호가1 — 단위: 원, 부호가 포함된 숫자')
    f_61: str | None = Field(None, alias='61', description='매도호가수량1 — 단위: 1주')
    f_81: str | None = Field(None, alias='81', description='매도호가직전대비1')
    f_51: str | None = Field(None, alias='51', description='매수호가1 — 단위: 원, 부호가 포함된 숫자')
    f_71: str | None = Field(None, alias='71', description='매수호가수량1 — 단위: 1주')
    f_91: str | None = Field(None, alias='91', description='매수호가직전대비1')
    f_42: str | None = Field(None, alias='42', description='매도호가2 — 단위: 원, 부호가 포함된 숫자')
    f_62: str | None = Field(None, alias='62', description='매도호가수량2 — 단위: 1주')
    f_82: str | None = Field(None, alias='82', description='매도호가직전대비2')
    f_52: str | None = Field(None, alias='52', description='매수호가2 — 단위: 원, 부호가 포함된 숫자')
    f_72: str | None = Field(None, alias='72', description='매수호가수량2 — 단위: 1주')
    f_92: str | None = Field(None, alias='92', description='매수호가직전대비2')
    f_43: str | None = Field(None, alias='43', description='매도호가3 — 단위: 원, 부호가 포함된 숫자')
    f_63: str | None = Field(None, alias='63', description='매도호가수량3 — 단위: 1주')
    f_83: str | None = Field(None, alias='83', description='매도호가직전대비3')
    f_53: str | None = Field(None, alias='53', description='매수호가3 — 단위: 원, 부호가 포함된 숫자')
    f_73: str | None = Field(None, alias='73', description='매수호가수량3 — 단위: 1주')
    f_93: str | None = Field(None, alias='93', description='매수호가직전대비3')
    f_44: str | None = Field(None, alias='44', description='매도호가4 — 단위: 원, 부호가 포함된 숫자')
    f_64: str | None = Field(None, alias='64', description='매도호가수량4 — 단위: 1주')
    f_84: str | None = Field(None, alias='84', description='매도호가직전대비4')
    f_54: str | None = Field(None, alias='54', description='매수호가4 — 단위: 원, 부호가 포함된 숫자')
    f_74: str | None = Field(None, alias='74', description='매수호가수량4 — 단위: 1주')
    f_94: str | None = Field(None, alias='94', description='매수호가직전대비4')
    f_45: str | None = Field(None, alias='45', description='매도호가5 — 단위: 원, 부호가 포함된 숫자')
    f_65: str | None = Field(None, alias='65', description='매도호가수량5 — 단위: 1주')
    f_85: str | None = Field(None, alias='85', description='매도호가직전대비5')
    f_55: str | None = Field(None, alias='55', description='매수호가5 — 단위: 원, 부호가 포함된 숫자')
    f_75: str | None = Field(None, alias='75', description='매수호가수량5 — 단위: 1주')
    f_95: str | None = Field(None, alias='95', description='매수호가직전대비5')
    f_46: str | None = Field(None, alias='46', description='매도호가6 — 단위: 원, 부호가 포함된 숫자')
    f_66: str | None = Field(None, alias='66', description='매도호가수량6 — 단위: 1주')
    f_86: str | None = Field(None, alias='86', description='매도호가직전대비6')
    f_56: str | None = Field(None, alias='56', description='매수호가6 — 단위: 원, 부호가 포함된 숫자')
    f_76: str | None = Field(None, alias='76', description='매수호가수량6 — 단위: 1주')
    f_96: str | None = Field(None, alias='96', description='매수호가직전대비6')
    f_47: str | None = Field(None, alias='47', description='매도호가7 — 단위: 원, 부호가 포함된 숫자')
    f_67: str | None = Field(None, alias='67', description='매도호가수량7 — 단위: 1주')
    f_87: str | None = Field(None, alias='87', description='매도호가직전대비7')
    f_57: str | None = Field(None, alias='57', description='매수호가7 — 단위: 원, 부호가 포함된 숫자')
    f_77: str | None = Field(None, alias='77', description='매수호가수량7 — 단위: 1주')
    f_97: str | None = Field(None, alias='97', description='매수호가직전대비7')
    f_48: str | None = Field(None, alias='48', description='매도호가8 — 단위: 원, 부호가 포함된 숫자')
    f_68: str | None = Field(None, alias='68', description='매도호가수량8 — 단위: 1주')
    f_88: str | None = Field(None, alias='88', description='매도호가직전대비8')
    f_58: str | None = Field(None, alias='58', description='매수호가8 — 단위: 원, 부호가 포함된 숫자')
    f_78: str | None = Field(None, alias='78', description='매수호가수량8 — 단위: 1주')
    f_98: str | None = Field(None, alias='98', description='매수호가직전대비8')
    f_49: str | None = Field(None, alias='49', description='매도호가9 — 단위: 원, 부호가 포함된 숫자')
    f_69: str | None = Field(None, alias='69', description='매도호가수량9 — 단위: 1주')
    f_89: str | None = Field(None, alias='89', description='매도호가직전대비9')
    f_59: str | None = Field(None, alias='59', description='매수호가9 — 단위: 원, 부호가 포함된 숫자')
    f_79: str | None = Field(None, alias='79', description='매수호가수량9 — 단위: 1주')
    f_99: str | None = Field(None, alias='99', description='매수호가직전대비9')
    f_50: str | None = Field(None, alias='50', description='매도호가10 — 단위: 원, 부호가 포함된 숫자')
    f_70: str | None = Field(None, alias='70', description='매도호가수량10 — 단위: 1주')
    f_60: str | None = Field(None, alias='60', description='매수호가10 — 단위: 원, 부호가 포함된 숫자')
    f_90: str | None = Field(None, alias='90', description='매도호가직전대비10')
    f_80: str | None = Field(None, alias='80', description='매수호가수량10 — 단위: 1주')
    f_100: str | None = Field(None, alias='100', description='매수호가직전대비10')
    f_121: str | None = Field(None, alias='121', description='매도호가총잔량 — 단위: 1주')
    f_122: str | None = Field(None, alias='122', description='매도호가총잔량직전대비')
    f_125: str | None = Field(None, alias='125', description='매수호가총잔량 — 단위: 1주')
    f_126: str | None = Field(None, alias='126', description='매수호가총잔량직전대비')
    f_23: str | None = Field(None, alias='23', description='예상체결가 — 단위: 원')
    f_24: str | None = Field(None, alias='24', description='예상체결수량 — 단위: 1주')
    f_128: str | None = Field(None, alias='128', description='순매수잔량 — 단위: 1주, 부호가 포함된 숫자')
    f_129: str | None = Field(None, alias='129', description='매수비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_138: str | None = Field(None, alias='138', description='순매도잔량 — 단위: 1주, 부호가 포함된 숫자')
    f_139: str | None = Field(None, alias='139', description='매도비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_200: str | None = Field(None, alias='200', description='예상체결가전일종가대비')
    f_201: str | None = Field(None, alias='201', description='예상체결가전일종가대비등락율')
    f_238: str | None = Field(None, alias='238', description='예상체결가전일종가대비기호')
    f_291: str | None = Field(None, alias='291', description='예상체결가 — 예상체결 시간동안에만 유효한 값')
    f_292: str | None = Field(None, alias='292', description='예상체결량')
    f_293: str | None = Field(None, alias='293', description='예상체결가전일대비기호')
    f_294: str | None = Field(None, alias='294', description='예상체결가전일대비')
    f_295: str | None = Field(None, alias='295', description='예상체결가전일대비등락율')
    f_621: str | None = Field(None, alias='621', description='LP매도호가수량1')
    f_631: str | None = Field(None, alias='631', description='LP매수호가수량1')
    f_622: str | None = Field(None, alias='622', description='LP매도호가수량2')
    f_632: str | None = Field(None, alias='632', description='LP매수호가수량2')
    f_623: str | None = Field(None, alias='623', description='LP매도호가수량3')
    f_633: str | None = Field(None, alias='633', description='LP매수호가수량3')
    f_624: str | None = Field(None, alias='624', description='LP매도호가수량4')
    f_634: str | None = Field(None, alias='634', description='LP매수호가수량4')
    f_625: str | None = Field(None, alias='625', description='LP매도호가수량5')
    f_635: str | None = Field(None, alias='635', description='LP매수호가수량5')
    f_626: str | None = Field(None, alias='626', description='LP매도호가수량6')
    f_636: str | None = Field(None, alias='636', description='LP매수호가수량6')
    f_627: str | None = Field(None, alias='627', description='LP매도호가수량7')
    f_637: str | None = Field(None, alias='637', description='LP매수호가수량7')
    f_628: str | None = Field(None, alias='628', description='LP매도호가수량8')
    f_638: str | None = Field(None, alias='638', description='LP매수호가수량8')
    f_629: str | None = Field(None, alias='629', description='LP매도호가수량9')
    f_639: str | None = Field(None, alias='639', description='LP매수호가수량9')
    f_630: str | None = Field(None, alias='630', description='LP매도호가수량10')
    f_640: str | None = Field(None, alias='640', description='LP매수호가수량10')
    f_13: str | None = Field(None, alias='13', description='누적거래량')
    f_299: str | None = Field(None, alias='299', description='전일거래량대비예상체결율')
    f_215: str | None = Field(None, alias='215', description='장운영구분')
    f_216: str | None = Field(None, alias='216', description='투자자별ticker')
    f_6044: str | None = Field(None, alias='6044', description='KRX 매도호가잔량1')
    f_6045: str | None = Field(None, alias='6045', description='KRX 매도호가잔량2')
    f_6046: str | None = Field(None, alias='6046', description='KRX 매도호가잔량3')
    f_6047: str | None = Field(None, alias='6047', description='KRX 매도호가잔량4')
    f_6048: str | None = Field(None, alias='6048', description='KRX 매도호가잔량5')
    f_6049: str | None = Field(None, alias='6049', description='KRX 매도호가잔량6')
    f_6050: str | None = Field(None, alias='6050', description='KRX 매도호가잔량7')
    f_6051: str | None = Field(None, alias='6051', description='KRX 매도호가잔량8')
    f_6052: str | None = Field(None, alias='6052', description='KRX 매도호가잔량9')
    f_6053: str | None = Field(None, alias='6053', description='KRX 매도호가잔량10')
    f_6054: str | None = Field(None, alias='6054', description='KRX 매수호가잔량1')
    f_6055: str | None = Field(None, alias='6055', description='KRX 매수호가잔량2')
    f_6056: str | None = Field(None, alias='6056', description='KRX 매수호가잔량3')
    f_6057: str | None = Field(None, alias='6057', description='KRX 매수호가잔량4')
    f_6058: str | None = Field(None, alias='6058', description='KRX 매수호가잔량5')
    f_6059: str | None = Field(None, alias='6059', description='KRX 매수호가잔량6')
    f_6060: str | None = Field(None, alias='6060', description='KRX 매수호가잔량7')
    f_6061: str | None = Field(None, alias='6061', description='KRX 매수호가잔량8')
    f_6062: str | None = Field(None, alias='6062', description='KRX 매수호가잔량9')
    f_6063: str | None = Field(None, alias='6063', description='KRX 매수호가잔량10')
    f_6064: str | None = Field(None, alias='6064', description='KRX 매도호가총잔량')
    f_6065: str | None = Field(None, alias='6065', description='KRX 매수호가총잔량')
    f_6066: str | None = Field(None, alias='6066', description='NXT 매도호가잔량1')
    f_6067: str | None = Field(None, alias='6067', description='NXT 매도호가잔량2')
    f_6068: str | None = Field(None, alias='6068', description='NXT 매도호가잔량3')
    f_6069: str | None = Field(None, alias='6069', description='NXT 매도호가잔량4')
    f_6070: str | None = Field(None, alias='6070', description='NXT 매도호가잔량5')
    f_6071: str | None = Field(None, alias='6071', description='NXT 매도호가잔량6')
    f_6072: str | None = Field(None, alias='6072', description='NXT 매도호가잔량7')
    f_6073: str | None = Field(None, alias='6073', description='NXT 매도호가잔량8')
    f_6074: str | None = Field(None, alias='6074', description='NXT 매도호가잔량9')
    f_6075: str | None = Field(None, alias='6075', description='NXT 매도호가잔량10')
    f_6076: str | None = Field(None, alias='6076', description='NXT 매수호가잔량1')
    f_6077: str | None = Field(None, alias='6077', description='NXT 매수호가잔량2')
    f_6078: str | None = Field(None, alias='6078', description='NXT 매수호가잔량3')
    f_6079: str | None = Field(None, alias='6079', description='NXT 매수호가잔량4')
    f_6080: str | None = Field(None, alias='6080', description='NXT 매수호가잔량5')
    f_6081: str | None = Field(None, alias='6081', description='NXT 매수호가잔량6')
    f_6082: str | None = Field(None, alias='6082', description='NXT 매수호가잔량7')
    f_6083: str | None = Field(None, alias='6083', description='NXT 매수호가잔량8')
    f_6084: str | None = Field(None, alias='6084', description='NXT 매수호가잔량9')
    f_6085: str | None = Field(None, alias='6085', description='NXT 매수호가잔량10')
    f_6086: str | None = Field(None, alias='6086', description='NXT 매도호가총잔량')
    f_6087: str | None = Field(None, alias='6087', description='NXT 매수호가총잔량')
    f_6100: str | None = Field(None, alias='6100', description='KRX 중간가 매도 총잔량 증감')
    f_6101: str | None = Field(None, alias='6101', description='KRX 중간가 매도 총잔량')
    f_6102: str | None = Field(None, alias='6102', description='KRX 중간가')
    f_6103: str | None = Field(None, alias='6103', description='KRX 중간가 매수 총잔량')
    f_6104: str | None = Field(None, alias='6104', description='KRX 중간가 매수 총잔량 증감')
    f_6105: str | None = Field(None, alias='6105', description='NXT중간가 매도 총잔량 증감')
    f_6106: str | None = Field(None, alias='6106', description='NXT중간가 매도 총잔량')
    f_6107: str | None = Field(None, alias='6107', description='NXT중간가')
    f_6108: str | None = Field(None, alias='6108', description='NXT중간가 매수 총잔량')
    f_6109: str | None = Field(None, alias='6109', description='NXT중간가 매수 총잔량 증감')
    f_6110: str | None = Field(None, alias='6110', description='KRX중간가대비 — 기준가대비')
    f_6111: str | None = Field(None, alias='6111', description='KRX중간가대비 기호 — 기준가대비')
    f_6112: str | None = Field(None, alias='6112', description='KRX중간가대비등락율 — 기준가대비')
    f_6113: str | None = Field(None, alias='6113', description='NXT중간가대비 — 기준가대비')
    f_6114: str | None = Field(None, alias='6114', description='NXT중간가대비 기호 — 기준가대비')
    f_6115: str | None = Field(None, alias='6115', description='NXT중간가대비등락율 — 기준가대비')


class Tr0DResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0D'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0DResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0ERequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0ERequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0E'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0ERequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0EResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_21: str | None = Field(None, alias='21', description='호가시간 — HHmmss')
    f_131: str | None = Field(None, alias='131', description='시간외매도호가총잔량 — 단위: 1주')
    f_132: str | None = Field(None, alias='132', description='시간외매도호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    f_135: str | None = Field(None, alias='135', description='시간외매수호가총잔량 — 단위: 1주')
    f_136: str | None = Field(None, alias='136', description='시간외매수호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')


class Tr0EResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0E'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0EResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0FRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0FRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0F'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0FRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0FResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_141: str | None = Field(None, alias='141', description='매도거래원1')
    f_161: str | None = Field(None, alias='161', description='매도거래원수량1 — 단위: 1주')
    f_166: str | None = Field(None, alias='166', description='매도거래원별증감1 — 단위: 1주, 부호가 포함된 숫자')
    f_146: str | None = Field(None, alias='146', description='매도거래원코드1')
    f_271: str | None = Field(None, alias='271', description='매도거래원색깔1')
    f_151: str | None = Field(None, alias='151', description='매수거래원1')
    f_171: str | None = Field(None, alias='171', description='매수거래원수량1 — 단위: 1주')
    f_176: str | None = Field(None, alias='176', description='매수거래원별증감1 — 단위: 1주, 부호가 포함된 숫자')
    f_156: str | None = Field(None, alias='156', description='매수거래원코드1')
    f_281: str | None = Field(None, alias='281', description='매수거래원색깔1')
    f_142: str | None = Field(None, alias='142', description='매도거래원2')
    f_162: str | None = Field(None, alias='162', description='매도거래원수량2 — 단위: 1주')
    f_167: str | None = Field(None, alias='167', description='매도거래원별증감2 — 단위: 1주, 부호가 포함된 숫자')
    f_147: str | None = Field(None, alias='147', description='매도거래원코드2')
    f_272: str | None = Field(None, alias='272', description='매도거래원색깔2')
    f_152: str | None = Field(None, alias='152', description='매수거래원2')
    f_172: str | None = Field(None, alias='172', description='매수거래원수량2 — 단위: 1주')
    f_177: str | None = Field(None, alias='177', description='매수거래원별증감2 — 단위: 1주, 부호가 포함된 숫자')
    f_157: str | None = Field(None, alias='157', description='매수거래원코드2')
    f_282: str | None = Field(None, alias='282', description='매수거래원색깔2')
    f_143: str | None = Field(None, alias='143', description='매도거래원3')
    f_163: str | None = Field(None, alias='163', description='매도거래원수량3 — 단위: 1주')
    f_168: str | None = Field(None, alias='168', description='매도거래원별증감3 — 단위: 1주, 부호가 포함된 숫자')
    f_148: str | None = Field(None, alias='148', description='매도거래원코드3')
    f_273: str | None = Field(None, alias='273', description='매도거래원색깔3')
    f_153: str | None = Field(None, alias='153', description='매수거래원3')
    f_173: str | None = Field(None, alias='173', description='매수거래원수량3 — 단위: 1주')
    f_178: str | None = Field(None, alias='178', description='매수거래원별증감3 — 단위: 1주, 부호가 포함된 숫자')
    f_158: str | None = Field(None, alias='158', description='매수거래원코드3')
    f_283: str | None = Field(None, alias='283', description='매수거래원색깔3')
    f_144: str | None = Field(None, alias='144', description='매도거래원4')
    f_164: str | None = Field(None, alias='164', description='매도거래원수량4 — 단위: 1주')
    f_169: str | None = Field(None, alias='169', description='매도거래원별증감4 — 단위: 1주, 부호가 포함된 숫자')
    f_149: str | None = Field(None, alias='149', description='매도거래원코드4')
    f_274: str | None = Field(None, alias='274', description='매도거래원색깔4')
    f_154: str | None = Field(None, alias='154', description='매수거래원4')
    f_174: str | None = Field(None, alias='174', description='매수거래원수량4 — 단위: 1주')
    f_179: str | None = Field(None, alias='179', description='매수거래원별증감4 — 단위: 1주, 부호가 포함된 숫자')
    f_159: str | None = Field(None, alias='159', description='매수거래원코드4')
    f_284: str | None = Field(None, alias='284', description='매수거래원색깔4')
    f_145: str | None = Field(None, alias='145', description='매도거래원5')
    f_165: str | None = Field(None, alias='165', description='매도거래원수량5 — 단위: 1주')
    f_170: str | None = Field(None, alias='170', description='매도거래원별증감5 — 단위: 1주, 부호가 포함된 숫자')
    f_150: str | None = Field(None, alias='150', description='매도거래원코드5')
    f_275: str | None = Field(None, alias='275', description='매도거래원색깔5')
    f_155: str | None = Field(None, alias='155', description='매수거래원5')
    f_175: str | None = Field(None, alias='175', description='매수거래원수량5 — 단위: 1주')
    f_180: str | None = Field(None, alias='180', description='매수거래원별증감5 — 단위: 1주, 부호가 포함된 숫자')
    f_160: str | None = Field(None, alias='160', description='매수거래원코드5')
    f_285: str | None = Field(None, alias='285', description='매수거래원색깔5')
    f_261: str | None = Field(None, alias='261', description='외국계매도추정합')
    f_262: str | None = Field(None, alias='262', description='외국계매도추정합변동')
    f_263: str | None = Field(None, alias='263', description='외국계매수추정합')
    f_264: str | None = Field(None, alias='264', description='외국계매수추정합변동')
    f_267: str | None = Field(None, alias='267', description='외국계순매수추정합')
    f_268: str | None = Field(None, alias='268', description='외국계순매수변동')
    f_337: str | None = Field(None, alias='337', description='거래소구분')


class Tr0FResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0F'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0FResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0GRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0GRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0G'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0GRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0GResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_36: str | None = Field(None, alias='36', description='NAV — 부호 포함 소수점 둘째 자리까지 포맷된 숫자')
    f_37: str | None = Field(None, alias='37', description='NAV전일대비 — 부호 포함 소수점 둘째 자리까지 포맷된 숫자')
    f_38: str | None = Field(None, alias='38', description='NAV등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_39: str | None = Field(None, alias='39', description='추적오차율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    f_667: str | None = Field(None, alias='667', description='ELW기어링비율')
    f_668: str | None = Field(None, alias='668', description='ELW손익분기율')
    f_669: str | None = Field(None, alias='669', description='ELW자본지지점')
    f_265: str | None = Field(None, alias='265', description='NAV/지수괴리율')
    f_266: str | None = Field(None, alias='266', description='NAV/ETF괴리율')


class Tr0GResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0G'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0GResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0HRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0HRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0H'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0HRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0HResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_15: str | None = Field(None, alias='15', description='거래량 — +는 매수체결, -는 매도체결')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Tr0HResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0H'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0HResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0IRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — MGD: 원/g, MGU: $/온스,소수점2자리')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0IRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0I'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0IRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0IResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0B,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1:상한, 2:상승, 3:없음, 4:하한, 5:하락')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Tr0IResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0I'
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0IResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0JRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0JRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0J'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0JRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0JResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_15: str | None = Field(None, alias='15', description='거래량 — +는 매수체결,-는 매도체결')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_14: str | None = Field(None, alias='14', description='누적거래대금 — 단위: 백만원')
    f_16: str | None = Field(None, alias='16', description='시가 — 단위: 원, 부호가 포함된 숫자')
    f_17: str | None = Field(None, alias='17', description='고가 — 단위: 원, 부호가 포함된 숫자')
    f_18: str | None = Field(None, alias='18', description='저가 — 단위: 원, 부호가 포함된 숫자')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    f_26: str | None = Field(None, alias='26', description='전일거래량대비 — 계약,주')


class Tr0JResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0J'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0JResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0URequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0URequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0U'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0URequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0UResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_252: str | None = Field(None, alias='252', description='상승종목수')
    f_251: str | None = Field(None, alias='251', description='상한종목수')
    f_253: str | None = Field(None, alias='253', description='보합종목수')
    f_255: str | None = Field(None, alias='255', description='하락종목수')
    f_254: str | None = Field(None, alias='254', description='하한종목수')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_14: str | None = Field(None, alias='14', description='누적거래대금 — 단위: 백만원')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_256: str | None = Field(None, alias='256', description='거래형성종목수 — 계약,주')
    f_257: str | None = Field(None, alias='257', description='거래형성비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Tr0UResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0U'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0UResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0gRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0gRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0g'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0gRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0gResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_297: str | None = Field(None, alias='297', description='임의연장')
    f_592: str | None = Field(None, alias='592', description='장전임의연장')
    f_593: str | None = Field(None, alias='593', description='장후임의연장')
    f_305: str | None = Field(None, alias='305', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    f_306: str | None = Field(None, alias='306', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    f_307: str | None = Field(None, alias='307', description='기준가 — 단위: 원')
    f_689: str | None = Field(None, alias='689', description='조기종료ELW발생')
    f_594: str | None = Field(None, alias='594', description='통화단위')
    f_382: str | None = Field(None, alias='382', description='증거금율표시')
    f_370: str | None = Field(None, alias='370', description='종목정보')


class Tr0gResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0g'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0gResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0mRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0mRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0m'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0mRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0mResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_670: str | None = Field(None, alias='670', description='ELW이론가')
    f_671: str | None = Field(None, alias='671', description='ELW내재변동성')
    f_672: str | None = Field(None, alias='672', description='ELW델타')
    f_673: str | None = Field(None, alias='673', description='ELW감마')
    f_674: str | None = Field(None, alias='674', description='ELW쎄타')
    f_675: str | None = Field(None, alias='675', description='ELW베가')
    f_676: str | None = Field(None, alias='676', description='ELW로')
    f_706: str | None = Field(None, alias='706', description='LP호가내재변동성')


class Tr0mResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0m'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0mResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0sRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0sRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0s'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0sRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0sResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_215: str | None = Field(None, alias='215', description='장운영구분 — 0 : 장시작전 알림(8:40~),\n3 : 장시작(09:00),\n2 : 장마감 알림(15:20~),\n4 : 장마감(15:30),\n8 : 정규장마감(거래소 수신시 15:30 이후),\n9 : 전체장마감(거래소 수신시 18:00 이후),\na : 시간외 종가매매 시작(15:40),\nb : 시간외 종가매매 종료(16:00),\nc : 시간외 단일가 시작(16:00),\nd : 시간외 단일가 종료(18:00),\ne : 선옵 장마감전 동시호가 종료,\nf : 선물옵션 장운영시간 알림(조기개장 상품),\no : 선옵 장시작,\ns : 선옵 장마감전 동시호가 시작,\nP : NXT 프리마켓 시작 알림,\nQ : NXT 프리마켓 종료 알림,\nR : NXT 메인마켓 시작 알림,\nS : NXT 메인마켓 종료 알림,\nT : NXT 에프터마켓 단일가 시작 알림,\nU : NXT 에프터마켓 시작 알림,\nV : NXT 에프터마켓 종료 알림')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_214: str | None = Field(None, alias='214', description='장시작예상잔여시간 — HHmmss')


class Tr0sResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0s'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0sResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0uRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0uRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0u'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0uRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0uResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_666: str | None = Field(None, alias='666', description='ELW패리티')
    f_1211: str | None = Field(None, alias='1211', description='ELW프리미엄')
    f_667: str | None = Field(None, alias='667', description='ELW기어링비율')
    f_668: str | None = Field(None, alias='668', description='ELW손익분기율')
    f_669: str | None = Field(None, alias='669', description='ELW자본지지점')


class Tr0uResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0u'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0uResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr0wRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr0wRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '0w'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr0wRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr0wResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_20: str | None = Field(None, alias='20', description='체결시간 — HHmmss')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    f_12: str | None = Field(None, alias='12', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_202: str | None = Field(None, alias='202', description='매도수량 — 단위: 1주')
    f_204: str | None = Field(None, alias='204', description='매도금액 — 단위: 원')
    f_206: str | None = Field(None, alias='206', description='매수수량 — 단위: 1주')
    f_208: str | None = Field(None, alias='208', description='매수금액')
    f_210: str | None = Field(None, alias='210', description='순매수수량')
    f_211: str | None = Field(None, alias='211', description='순매수수량증감 — 계약,주')
    f_212: str | None = Field(None, alias='212', description='순매수금액')
    f_213: str | None = Field(None, alias='213', description='순매수금액증감')
    f_214: str | None = Field(None, alias='214', description='장시작예상잔여시간')
    f_215: str | None = Field(None, alias='215', description='장운영구분')
    f_216: str | None = Field(None, alias='216', description='투자자별ticker')


class Tr0wResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '0w'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr0wResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Tr1hRequestDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 거래소별 종목코드, 업종코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    type_: str = Field(..., alias='type', description='실시간 항목 — TR 명(0A,0B....)')


class Tr1hRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = '1h'
    trnm: str = Field(..., alias='trnm', description='서비스명 — REG : 등록 , REMOVE : 해지')
    grp_no: str = Field(..., alias='grp_no', description='그룹번호')
    refresh: str = Field(..., alias='refresh', description='기존등록유지여부 — 등록(REG)시\n0:기존유지안함 1:기존유지(Default)\n 0일경우 기존등록한 item/type은 해지, 1일경우 기존등록한 item/type 유지\n해지(REMOVE)시 값 불필요')
    data: list[Tr1hRequestDataItem] = Field(default_factory=list, alias='data', description='실시간 등록 리스트')


class Tr1hResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    type_: str | None = Field(None, alias='type', description='실시간항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명')
    item: str | None = Field(None, alias='item', description='실시간 등록 요소 — 종목코드')
    values: str | None = Field(None, alias='values', description='실시간 값 리스트')
    f_9001: str | None = Field(None, alias='9001', description='종목코드')
    f_302: str | None = Field(None, alias='302', description='종목명')
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주')
    f_14: str | None = Field(None, alias='14', description='누적거래대금 — 단위: 백만원')
    f_9068: str | None = Field(None, alias='9068', description='VI발동구분')
    f_9008: str | None = Field(None, alias='9008', description='KOSPI,KOSDAQ,전체구분')
    f_9075: str | None = Field(None, alias='9075', description='장전구분')
    f_1221: str | None = Field(None, alias='1221', description='VI발동가격 — 단위: 원')
    f_1223: str | None = Field(None, alias='1223', description='매매체결처리시각 — HHmmss')
    f_1224: str | None = Field(None, alias='1224', description='VI해제시각 — HHmmss')
    f_1225: str | None = Field(None, alias='1225', description='VI적용구분 — 정적/동적/동적+정적')
    f_1236: str | None = Field(None, alias='1236', description='기준가격 정적 — 계약,주')
    f_1237: str | None = Field(None, alias='1237', description='기준가격 동적')
    f_1238: str | None = Field(None, alias='1238', description='괴리율 정적')
    f_1239: str | None = Field(None, alias='1239', description='괴리율 동적')
    f_1489: str | None = Field(None, alias='1489', description='VI발동가 등락율')
    f_1490: str | None = Field(None, alias='1490', description='VI발동횟수')
    f_9069: str | None = Field(None, alias='9069', description='발동방향구분')
    f_1279: str | None = Field(None, alias='1279', description='Extra Item')


class Tr1hResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = '1h'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 통신결과에대한 코드\n(등록,해지요청시에만 값 전송 0:정상,1:오류 , 데이터 실시간 수신시 미전송)')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 통신결과에대한메시지')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — 등록,해지요청시 요청값 반환 , 실시간수신시 REAL 반환')
    data: list[Tr1hResponseDataItem] = Field(default_factory=list, alias='data', description='실시간 등록리스트')


class Au10001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'au10001'


class Au10001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'au10001'
    configured: bool | None = Field(None, alias='configured', description='Whether server-side credentials are configured.')
    ready: bool | None = Field(None, alias='ready', description='Whether the memory-only token is ready.')
    expires_at: str | None = Field(None, alias='expires_at', description='Token expiry timestamp; the token itself is never returned.')


class Au10002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'au10002'


class Au10002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'au10002'
    configured: bool | None = Field(None, alias='configured', description='Whether server-side credentials are configured.')
    ready: bool | None = Field(None, alias='ready', description='Whether the memory-only token is ready.')
    expires_at: str | None = Field(None, alias='expires_at', description='Token expiry timestamp; the token itself is never returned.')


class Ka00001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka00001'


class Ka00001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka00001'
    acctNo: str | None = Field(None, alias='acctNo', description='계좌번호 — 10자리 숫자가 출력됩니다. 뒤에 2자리는 당사에서 계좌를 분류하기 위한 값입니다.')


class Ka00198Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka00198'
    qry_tp: str = Field(..., alias='qry_tp', description='구분 — 1:1분, 2:10분, 3:1시간, 4:당일 누적, 5:30초')


class Ka00198ResponseItemInqRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    bigd_rank: str | None = Field(None, alias='bigd_rank', description='빅데이터 순위 — 0: 순위 변동 없음')
    rank_chg: str | None = Field(None, alias='rank_chg', description="순위 등락 — 순위 변동 없음(rank_chg=0)인 경우 빈값('') 출력")
    rank_chg_sign: str | None = Field(None, alias='rank_chg_sign', description="순위 등락 부호 — 순위상승: +, 순위하락: -, 순위변동없음: '")
    past_curr_prc: str | None = Field(None, alias='past_curr_prc', description='과거 현재가 — 기준 시점 주가, 부호가 포함된 원화 값')
    base_comp_sign: str | None = Field(None, alias='base_comp_sign', description='기준가 대비 부호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    base_comp_chgr: str | None = Field(None, alias='base_comp_chgr', description='기준가 대비 등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    prev_base_sign: str | None = Field(None, alias='prev_base_sign', description='직전 기준 대비 부호')
    prev_base_chgr: str | None = Field(None, alias='prev_base_chgr', description='직전 기준 대비 등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    dt: str | None = Field(None, alias='dt', description='일자 — 기준 일자, YYYYMMDD')
    tm: str | None = Field(None, alias='tm', description='시간 — 기준 시간, HHmmss')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')


class Ka00198Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka00198'
    item_inq_rank: list[Ka00198ResponseItemInqRankItem] = Field(default_factory=list, alias='item_inq_rank', description='실시간종목조회순위')


class Ka01300Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka01300'


class Ka01300ResponseNofiItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    gcod: str | None = Field(None, alias='gcod', description='그룹코드')
    name: str | None = Field(None, alias='name', description='그룹명')


class Ka01300Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka01300'
    rtcd: str | None = Field(None, alias='rtcd', description='처리결과 — S:성공 F:실패')
    nofi: list[Ka01300ResponseNofiItem] = Field(default_factory=list, alias='nofi', description='그룹갯수')


class Ka01301Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka01301'
    arn_grp_id: str = Field(..., alias='arn_grp_id', description='그룹SEQ — ka01300 응답 결과의 gcod값을 입력')


class Ka01301ResponseNofjItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cod2: str | None = Field(None, alias='cod2', description='종목코드')
    bgb: str | None = Field(None, alias='bgb', description='북마크 구분')
    bgb_clr: str | None = Field(None, alias='bgb_clr', description='북마크 컬러')


class Ka01301Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka01301'
    rtcd: str | None = Field(None, alias='rtcd', description='처리 결과 — S:성공 F:실패')
    nofj: list[Ka01301ResponseNofjItem] = Field(default_factory=list, alias='nofj', description='종목 갯수')


class Ka01690Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka01690'
    qry_dt: str = Field(..., alias='qry_dt', description='조회일자 — YYYYMMDD')


class Ka01690ResponseDayBalRtItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위 : 원')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    rmnd_qty: str | None = Field(None, alias='rmnd_qty', description='보유 수량 — 단위 : 1주')
    buy_uv: str | None = Field(None, alias='buy_uv', description='매입 단가 — 단위 : 원')
    buy_wght: str | None = Field(None, alias='buy_wght', description='매수비중 — 단위: %, 소수점 첫째 자리까지 포맷된 백분율')
    evltv_prft: str | None = Field(None, alias='evltv_prft', description='평가손익 — 단위 : 원')
    prft_rt: str | None = Field(None, alias='prft_rt', description='수익률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    evlt_amt: str | None = Field(None, alias='evlt_amt', description='평가금액 — 단위 : 원')
    evlt_wght: str | None = Field(None, alias='evlt_wght', description='평가비중 — 단위: %, 소수점 첫째 자리까지 포맷된 백분율')


class Ka01690Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka01690'
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    tot_buy_amt: str | None = Field(None, alias='tot_buy_amt', description='총 매입가 — 단위 : 원')
    tot_evlt_amt: str | None = Field(None, alias='tot_evlt_amt', description='총 평가금액 — 단위 : 원')
    tot_evltv_prft: str | None = Field(None, alias='tot_evltv_prft', description='총 평가손익 — 단위 : 원')
    tot_prft_rt: str | None = Field(None, alias='tot_prft_rt', description='수익률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    dbst_bal: str | None = Field(None, alias='dbst_bal', description='예수금 — 단위 : 원')
    day_stk_asst: str | None = Field(None, alias='day_stk_asst', description='추정자산 — 단위 : 원')
    buy_wght: str | None = Field(None, alias='buy_wght', description='현금비중 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    day_bal_rt: list[Ka01690ResponseDayBalRtItem] = Field(default_factory=list, alias='day_bal_rt', description='일별잔고수익률')


class Ka10001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10001'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    setl_mm: str | None = Field(None, alias='setl_mm', description='결산월')
    fav: str | None = Field(None, alias='fav', description='액면가 — 단위: 원')
    cap: str | None = Field(None, alias='cap', description='자본금 — 단위: 억원')
    flo_stk: str | None = Field(None, alias='flo_stk', description='상장주식 — 단위: 천원')
    crd_rt: str | None = Field(None, alias='crd_rt', description='신용비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    oyr_hgst: str | None = Field(None, alias='oyr_hgst', description='연중최고 — 단위: 원, 부호가 포함된 숫자')
    oyr_lwst: str | None = Field(None, alias='oyr_lwst', description='연중최저 — 단위: 원, 부호가 포함된 숫자')
    mac: str | None = Field(None, alias='mac', description='시가총액 — 단위: 억원')
    mac_wght: str | None = Field(None, alias='mac_wght', description='시가총액비중')
    for_exh_rt: str | None = Field(None, alias='for_exh_rt', description='외인소진률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    repl_pric: str | None = Field(None, alias='repl_pric', description='대용가 — 단위: 원')
    per: str | None = Field(None, alias='per', description='PER — [ 주의 ] PER, ROE 값들은 외부벤더사에서 제공되는 데이터이며 일주일에 한번 또는 실적발표 시즌에 업데이트 됨')
    eps: str | None = Field(None, alias='eps', description='EPS')
    roe: str | None = Field(None, alias='roe', description='ROE — [ 주의 ]  PER, ROE 값들은 외부벤더사에서 제공되는 데이터이며 일주일에 한번 또는 실적발표 시즌에 업데이트 됨')
    pbr: str | None = Field(None, alias='pbr', description='PBR')
    ev: str | None = Field(None, alias='ev', description='EV')
    bps: str | None = Field(None, alias='bps', description='BPS')
    sale_amt: str | None = Field(None, alias='sale_amt', description='매출액 — 단위: 억원')
    bus_pro: str | None = Field(None, alias='bus_pro', description='영업이익 — 단위: 억원')
    cup_nga: str | None = Field(None, alias='cup_nga', description='당기순이익 — 단위: 억원')
    f_250hgst: str | None = Field(None, alias='250hgst', description='250최고 — 단위: 원, 부호가 포함된 숫자')
    f_250lwst: str | None = Field(None, alias='250lwst', description='250최저 — 단위: 원, 부호가 포함된 숫자')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    upl_pric: str | None = Field(None, alias='upl_pric', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    lst_pric: str | None = Field(None, alias='lst_pric', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상체결가')
    exp_cntr_qty: str | None = Field(None, alias='exp_cntr_qty', description='예상체결수량')
    f_250hgst_pric_dt: str | None = Field(None, alias='250hgst_pric_dt', description='250최고가일 — YYYYMMDD')
    f_250hgst_pric_pre_rt: str | None = Field(None, alias='250hgst_pric_pre_rt', description='250최고가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_250lwst_pric_dt: str | None = Field(None, alias='250lwst_pric_dt', description='250최저가일 — YYYYMMDD')
    f_250lwst_pric_pre_rt: str | None = Field(None, alias='250lwst_pric_pre_rt', description='250최저가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_pre: str | None = Field(None, alias='trde_pre', description='거래대비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    fav_unit: str | None = Field(None, alias='fav_unit', description='액면가단위')
    dstr_stk: str | None = Field(None, alias='dstr_stk', description='유통주식 — 단위: 1주')
    dstr_rt: str | None = Field(None, alias='dstr_rt', description='유통비율 — 단위: %, 부호 포함 소수점 첫째 자리까지 포맷된 백분율')


class Ka10002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10002'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10002'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    flu_smbol: str | None = Field(None, alias='flu_smbol', description='등락부호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_trde_ori_nm_1: str | None = Field(None, alias='sel_trde_ori_nm_1', description='매도거래원명1')
    sel_trde_ori_1: str | None = Field(None, alias='sel_trde_ori_1', description='매도거래원1')
    sel_trde_qty_1: str | None = Field(None, alias='sel_trde_qty_1', description='매도거래량1 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_1: str | None = Field(None, alias='buy_trde_ori_nm_1', description='매수거래원명1')
    buy_trde_ori_1: str | None = Field(None, alias='buy_trde_ori_1', description='매수거래원1')
    buy_trde_qty_1: str | None = Field(None, alias='buy_trde_qty_1', description='매수거래량1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_2: str | None = Field(None, alias='sel_trde_ori_nm_2', description='매도거래원명2')
    sel_trde_ori_2: str | None = Field(None, alias='sel_trde_ori_2', description='매도거래원2')
    sel_trde_qty_2: str | None = Field(None, alias='sel_trde_qty_2', description='매도거래량2 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_2: str | None = Field(None, alias='buy_trde_ori_nm_2', description='매수거래원명2')
    buy_trde_ori_2: str | None = Field(None, alias='buy_trde_ori_2', description='매수거래원2')
    buy_trde_qty_2: str | None = Field(None, alias='buy_trde_qty_2', description='매수거래량2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_3: str | None = Field(None, alias='sel_trde_ori_nm_3', description='매도거래원명3')
    sel_trde_ori_3: str | None = Field(None, alias='sel_trde_ori_3', description='매도거래원3')
    sel_trde_qty_3: str | None = Field(None, alias='sel_trde_qty_3', description='매도거래량3 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_3: str | None = Field(None, alias='buy_trde_ori_nm_3', description='매수거래원명3')
    buy_trde_ori_3: str | None = Field(None, alias='buy_trde_ori_3', description='매수거래원3')
    buy_trde_qty_3: str | None = Field(None, alias='buy_trde_qty_3', description='매수거래량3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_4: str | None = Field(None, alias='sel_trde_ori_nm_4', description='매도거래원명4')
    sel_trde_ori_4: str | None = Field(None, alias='sel_trde_ori_4', description='매도거래원4')
    sel_trde_qty_4: str | None = Field(None, alias='sel_trde_qty_4', description='매도거래량4 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_4: str | None = Field(None, alias='buy_trde_ori_nm_4', description='매수거래원명4')
    buy_trde_ori_4: str | None = Field(None, alias='buy_trde_ori_4', description='매수거래원4')
    buy_trde_qty_4: str | None = Field(None, alias='buy_trde_qty_4', description='매수거래량4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_5: str | None = Field(None, alias='sel_trde_ori_nm_5', description='매도거래원명5')
    sel_trde_ori_5: str | None = Field(None, alias='sel_trde_ori_5', description='매도거래원5')
    sel_trde_qty_5: str | None = Field(None, alias='sel_trde_qty_5', description='매도거래량5 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_5: str | None = Field(None, alias='buy_trde_ori_nm_5', description='매수거래원명5')
    buy_trde_ori_5: str | None = Field(None, alias='buy_trde_ori_5', description='매수거래원5')
    buy_trde_qty_5: str | None = Field(None, alias='buy_trde_qty_5', description='매수거래량5 — 단위: 1주, 부호가 포함된 숫자')


class Ka10003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10003'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10003ResponseCntrInfrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pre_rt: str | None = Field(None, alias='pre_rt', description='대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pri_sel_bid_unit: str | None = Field(None, alias='pri_sel_bid_unit', description='우선매도호가단위 — 단위: 원, 부호가 포함된 숫자')
    pri_buy_bid_unit: str | None = Field(None, alias='pri_buy_bid_unit', description='우선매수호가단위 — 단위: 원, 부호가 포함된 숫자')
    cntr_trde_qty: str | None = Field(None, alias='cntr_trde_qty', description='체결거래량 — 단위: 1주, 부호가 포함된 숫자')
    sign: str | None = Field(None, alias='sign', description='sign — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 원')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — KRX , NXT , 통합')


class Ka10003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10003'
    cntr_infr: list[Ka10003ResponseCntrInfrItem] = Field(default_factory=list, alias='cntr_infr', description='체결정보')


class Ka10004Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10004'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10004Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    bid_req_base_tm: str | None = Field(None, alias='bid_req_base_tm', description='호가잔량기준시간 — YYYYMMDD')
    sel_10th_pre_req_pre: str | None = Field(None, alias='sel_10th_pre_req_pre', description='매도10차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_10th_pre_req: str | None = Field(None, alias='sel_10th_pre_req', description='매도10차선잔량 — 단위: 1주')
    sel_10th_pre_bid: str | None = Field(None, alias='sel_10th_pre_bid', description='매도10차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_9th_pre_req_pre: str | None = Field(None, alias='sel_9th_pre_req_pre', description='매도9차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_9th_pre_req: str | None = Field(None, alias='sel_9th_pre_req', description='매도9차선잔량 — 단위: 1주')
    sel_9th_pre_bid: str | None = Field(None, alias='sel_9th_pre_bid', description='매도9차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_8th_pre_req_pre: str | None = Field(None, alias='sel_8th_pre_req_pre', description='매도8차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_8th_pre_req: str | None = Field(None, alias='sel_8th_pre_req', description='매도8차선잔량 — 단위: 1주')
    sel_8th_pre_bid: str | None = Field(None, alias='sel_8th_pre_bid', description='매도8차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_7th_pre_req_pre: str | None = Field(None, alias='sel_7th_pre_req_pre', description='매도7차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_7th_pre_req: str | None = Field(None, alias='sel_7th_pre_req', description='매도7차선잔량 — 단위: 1주')
    sel_7th_pre_bid: str | None = Field(None, alias='sel_7th_pre_bid', description='매도7차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_6th_pre_req_pre: str | None = Field(None, alias='sel_6th_pre_req_pre', description='매도6차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_6th_pre_req: str | None = Field(None, alias='sel_6th_pre_req', description='매도6차선잔량 — 단위: 1주')
    sel_6th_pre_bid: str | None = Field(None, alias='sel_6th_pre_bid', description='매도6차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_5th_pre_req_pre: str | None = Field(None, alias='sel_5th_pre_req_pre', description='매도5차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_5th_pre_req: str | None = Field(None, alias='sel_5th_pre_req', description='매도5차선잔량 — 단위: 1주')
    sel_5th_pre_bid: str | None = Field(None, alias='sel_5th_pre_bid', description='매도5차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_4th_pre_req_pre: str | None = Field(None, alias='sel_4th_pre_req_pre', description='매도4차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_4th_pre_req: str | None = Field(None, alias='sel_4th_pre_req', description='매도4차선잔량 — 단위: 1주')
    sel_4th_pre_bid: str | None = Field(None, alias='sel_4th_pre_bid', description='매도4차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_3th_pre_req_pre: str | None = Field(None, alias='sel_3th_pre_req_pre', description='매도3차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_3th_pre_req: str | None = Field(None, alias='sel_3th_pre_req', description='매도3차선잔량 — 단위: 1주')
    sel_3th_pre_bid: str | None = Field(None, alias='sel_3th_pre_bid', description='매도3차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_2th_pre_req_pre: str | None = Field(None, alias='sel_2th_pre_req_pre', description='매도2차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_2th_pre_req: str | None = Field(None, alias='sel_2th_pre_req', description='매도2차선잔량 — 단위: 1주')
    sel_2th_pre_bid: str | None = Field(None, alias='sel_2th_pre_bid', description='매도2차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_1th_pre_req_pre: str | None = Field(None, alias='sel_1th_pre_req_pre', description='매도1차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_fpr_req: str | None = Field(None, alias='sel_fpr_req', description='매도최우선잔량 — 단위: 1주')
    sel_fpr_bid: str | None = Field(None, alias='sel_fpr_bid', description='매도최우선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_fpr_bid: str | None = Field(None, alias='buy_fpr_bid', description='매수최우선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_fpr_req: str | None = Field(None, alias='buy_fpr_req', description='매수최우선잔량 — 단위: 1주')
    buy_1th_pre_req_pre: str | None = Field(None, alias='buy_1th_pre_req_pre', description='매수1차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_2th_pre_bid: str | None = Field(None, alias='buy_2th_pre_bid', description='매수2차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_2th_pre_req: str | None = Field(None, alias='buy_2th_pre_req', description='매수2차선잔량 — 단위: 1주')
    buy_2th_pre_req_pre: str | None = Field(None, alias='buy_2th_pre_req_pre', description='매수2차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_3th_pre_bid: str | None = Field(None, alias='buy_3th_pre_bid', description='매수3차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_3th_pre_req: str | None = Field(None, alias='buy_3th_pre_req', description='매수3차선잔량 — 단위: 1주')
    buy_3th_pre_req_pre: str | None = Field(None, alias='buy_3th_pre_req_pre', description='매수3차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_4th_pre_bid: str | None = Field(None, alias='buy_4th_pre_bid', description='매수4차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_4th_pre_req: str | None = Field(None, alias='buy_4th_pre_req', description='매수4차선잔량 — 단위: 1주')
    buy_4th_pre_req_pre: str | None = Field(None, alias='buy_4th_pre_req_pre', description='매수4차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_5th_pre_bid: str | None = Field(None, alias='buy_5th_pre_bid', description='매수5차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_5th_pre_req: str | None = Field(None, alias='buy_5th_pre_req', description='매수5차선잔량 — 단위: 1주')
    buy_5th_pre_req_pre: str | None = Field(None, alias='buy_5th_pre_req_pre', description='매수5차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_6th_pre_bid: str | None = Field(None, alias='buy_6th_pre_bid', description='매수6차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_6th_pre_req: str | None = Field(None, alias='buy_6th_pre_req', description='매수6차선잔량 — 단위: 1주')
    buy_6th_pre_req_pre: str | None = Field(None, alias='buy_6th_pre_req_pre', description='매수6차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_7th_pre_bid: str | None = Field(None, alias='buy_7th_pre_bid', description='매수7차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_7th_pre_req: str | None = Field(None, alias='buy_7th_pre_req', description='매수7차선잔량 — 단위: 1주')
    buy_7th_pre_req_pre: str | None = Field(None, alias='buy_7th_pre_req_pre', description='매수7차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_8th_pre_bid: str | None = Field(None, alias='buy_8th_pre_bid', description='매수8차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_8th_pre_req: str | None = Field(None, alias='buy_8th_pre_req', description='매수8차선잔량 — 단위: 1주')
    buy_8th_pre_req_pre: str | None = Field(None, alias='buy_8th_pre_req_pre', description='매수8차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_9th_pre_bid: str | None = Field(None, alias='buy_9th_pre_bid', description='매수9차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_9th_pre_req: str | None = Field(None, alias='buy_9th_pre_req', description='매수9차선잔량 — 단위: 1주')
    buy_9th_pre_req_pre: str | None = Field(None, alias='buy_9th_pre_req_pre', description='매수9차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_10th_pre_bid: str | None = Field(None, alias='buy_10th_pre_bid', description='매수10차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_10th_pre_req: str | None = Field(None, alias='buy_10th_pre_req', description='매수10차선잔량 — 단위: 1주')
    buy_10th_pre_req_pre: str | None = Field(None, alias='buy_10th_pre_req_pre', description='매수10차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    tot_sel_req_jub_pre: str | None = Field(None, alias='tot_sel_req_jub_pre', description='총매도잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')
    tot_buy_req_jub_pre: str | None = Field(None, alias='tot_buy_req_jub_pre', description='총매수잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_req_pre: str | None = Field(None, alias='ovt_sel_req_pre', description='시간외매도잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_req: str | None = Field(None, alias='ovt_sel_req', description='시간외매도잔량 — 단위: 1주, 시간외 매도호가 총잔량')
    ovt_buy_req: str | None = Field(None, alias='ovt_buy_req', description='시간외매수잔량 — 단위: 1주, 시간외 매수호가 총잔량')
    ovt_buy_req_pre: str | None = Field(None, alias='ovt_buy_req_pre', description='시간외매수잔량대비 — 단위: 1주, 부호가 포함된 숫자, 시간외 매수호가 총잔량 직전대비')


class Ka10005Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10005'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10005ResponseStkDdwkmmItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pre: str | None = Field(None, alias='pre', description='대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    for_poss: str | None = Field(None, alias='for_poss', description='외인보유 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    for_wght: str | None = Field(None, alias='for_wght', description='외인비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    for_netprps: str | None = Field(None, alias='for_netprps', description='외인순매수')
    orgn_netprps: str | None = Field(None, alias='orgn_netprps', description='기관순매수')
    ind_netprps: str | None = Field(None, alias='ind_netprps', description='개인순매수')
    crd_remn_rt: str | None = Field(None, alias='crd_remn_rt', description='신용잔고율')
    frgn: str | None = Field(None, alias='frgn', description='외국계 — 단위: 1주, 부호가 포함된 숫자')
    prm: str | None = Field(None, alias='prm', description='프로그램 — 단위: 1주, 부호가 포함된 숫자')


class Ka10005Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10005'
    stk_ddwkmm: list[Ka10005ResponseStkDdwkmmItem] = Field(default_factory=list, alias='stk_ddwkmm', description='주식일주월시분')


class Ka10006Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10006'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10006Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10006'
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pre: str | None = Field(None, alias='pre', description='대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Ka10007Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10007'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10007Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    pred_close_pric: str | None = Field(None, alias='pred_close_pric', description='전일종가 — 단위: 원')
    pred_trde_qty: str | None = Field(None, alias='pred_trde_qty', description='전일거래량 — 단위: 1주')
    upl_pric: str | None = Field(None, alias='upl_pric', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    lst_pric: str | None = Field(None, alias='lst_pric', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    pred_trde_prica: str | None = Field(None, alias='pred_trde_prica', description='전일거래대금 — 단위: 백만원')
    flo_stkcnt: str | None = Field(None, alias='flo_stkcnt', description='상장주식수 — 단위: 1주')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    smbol: str | None = Field(None, alias='smbol', description='부호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pred_rt: str | None = Field(None, alias='pred_rt', description='전일비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상체결가 — 단위: 원, 부호가 포함된 숫자')
    exp_cntr_qty: str | None = Field(None, alias='exp_cntr_qty', description='예상체결량 — 단위: 1주')
    exp_sel_pri_bid: str | None = Field(None, alias='exp_sel_pri_bid', description='예상매도우선호가 — 단위: 원, 부호가 포함된 숫자')
    exp_buy_pri_bid: str | None = Field(None, alias='exp_buy_pri_bid', description='예상매수우선호가 — 단위: 원, 부호가 포함된 숫자')
    trde_strt_dt: str | None = Field(None, alias='trde_strt_dt', description='거래시작일 — YYYYMMDD')
    exec_pric: str | None = Field(None, alias='exec_pric', description='행사가격 — 단위: 원')
    hgst_pric: str | None = Field(None, alias='hgst_pric', description='최고가 — 단위: 원, 부호가 포함된 숫자')
    lwst_pric: str | None = Field(None, alias='lwst_pric', description='최저가 — 단위: 원, 부호가 포함된 숫자')
    hgst_pric_dt: str | None = Field(None, alias='hgst_pric_dt', description='최고가일 — YYYYMMDD')
    lwst_pric_dt: str | None = Field(None, alias='lwst_pric_dt', description='최저가일 — YYYYMMDD')
    sel_1bid: str | None = Field(None, alias='sel_1bid', description='매도1호가 — 단위: 원, 부호가 포함된 숫자')
    sel_2bid: str | None = Field(None, alias='sel_2bid', description='매도2호가 — 단위: 원, 부호가 포함된 숫자')
    sel_3bid: str | None = Field(None, alias='sel_3bid', description='매도3호가 — 단위: 원, 부호가 포함된 숫자')
    sel_4bid: str | None = Field(None, alias='sel_4bid', description='매도4호가 — 단위: 원, 부호가 포함된 숫자')
    sel_5bid: str | None = Field(None, alias='sel_5bid', description='매도5호가 — 단위: 원, 부호가 포함된 숫자')
    sel_6bid: str | None = Field(None, alias='sel_6bid', description='매도6호가 — 단위: 원, 부호가 포함된 숫자')
    sel_7bid: str | None = Field(None, alias='sel_7bid', description='매도7호가 — 단위: 원, 부호가 포함된 숫자')
    sel_8bid: str | None = Field(None, alias='sel_8bid', description='매도8호가 — 단위: 원, 부호가 포함된 숫자')
    sel_9bid: str | None = Field(None, alias='sel_9bid', description='매도9호가 — 단위: 원, 부호가 포함된 숫자')
    sel_10bid: str | None = Field(None, alias='sel_10bid', description='매도10호가 — 단위: 원, 부호가 포함된 숫자')
    buy_1bid: str | None = Field(None, alias='buy_1bid', description='매수1호가 — 단위: 원, 부호가 포함된 숫자')
    buy_2bid: str | None = Field(None, alias='buy_2bid', description='매수2호가 — 단위: 원, 부호가 포함된 숫자')
    buy_3bid: str | None = Field(None, alias='buy_3bid', description='매수3호가 — 단위: 원, 부호가 포함된 숫자')
    buy_4bid: str | None = Field(None, alias='buy_4bid', description='매수4호가 — 단위: 원, 부호가 포함된 숫자')
    buy_5bid: str | None = Field(None, alias='buy_5bid', description='매수5호가 — 단위: 원, 부호가 포함된 숫자')
    buy_6bid: str | None = Field(None, alias='buy_6bid', description='매수6호가 — 단위: 원, 부호가 포함된 숫자')
    buy_7bid: str | None = Field(None, alias='buy_7bid', description='매수7호가 — 단위: 원, 부호가 포함된 숫자')
    buy_8bid: str | None = Field(None, alias='buy_8bid', description='매수8호가 — 단위: 원, 부호가 포함된 숫자')
    buy_9bid: str | None = Field(None, alias='buy_9bid', description='매수9호가 — 단위: 원, 부호가 포함된 숫자')
    buy_10bid: str | None = Field(None, alias='buy_10bid', description='매수10호가 — 단위: 원, 부호가 포함된 숫자')
    sel_1bid_req: str | None = Field(None, alias='sel_1bid_req', description='매도1호가잔량 — 단위: 1주')
    sel_2bid_req: str | None = Field(None, alias='sel_2bid_req', description='매도2호가잔량 — 단위: 1주')
    sel_3bid_req: str | None = Field(None, alias='sel_3bid_req', description='매도3호가잔량 — 단위: 1주')
    sel_4bid_req: str | None = Field(None, alias='sel_4bid_req', description='매도4호가잔량 — 단위: 1주')
    sel_5bid_req: str | None = Field(None, alias='sel_5bid_req', description='매도5호가잔량 — 단위: 1주')
    sel_6bid_req: str | None = Field(None, alias='sel_6bid_req', description='매도6호가잔량 — 단위: 1주')
    sel_7bid_req: str | None = Field(None, alias='sel_7bid_req', description='매도7호가잔량 — 단위: 1주')
    sel_8bid_req: str | None = Field(None, alias='sel_8bid_req', description='매도8호가잔량 — 단위: 1주')
    sel_9bid_req: str | None = Field(None, alias='sel_9bid_req', description='매도9호가잔량 — 단위: 1주')
    sel_10bid_req: str | None = Field(None, alias='sel_10bid_req', description='매도10호가잔량 — 단위: 1주')
    buy_1bid_req: str | None = Field(None, alias='buy_1bid_req', description='매수1호가잔량 — 단위: 1주')
    buy_2bid_req: str | None = Field(None, alias='buy_2bid_req', description='매수2호가잔량 — 단위: 1주')
    buy_3bid_req: str | None = Field(None, alias='buy_3bid_req', description='매수3호가잔량 — 단위: 1주')
    buy_4bid_req: str | None = Field(None, alias='buy_4bid_req', description='매수4호가잔량 — 단위: 1주')
    buy_5bid_req: str | None = Field(None, alias='buy_5bid_req', description='매수5호가잔량 — 단위: 1주')
    buy_6bid_req: str | None = Field(None, alias='buy_6bid_req', description='매수6호가잔량 — 단위: 1주')
    buy_7bid_req: str | None = Field(None, alias='buy_7bid_req', description='매수7호가잔량 — 단위: 1주')
    buy_8bid_req: str | None = Field(None, alias='buy_8bid_req', description='매수8호가잔량 — 단위: 1주')
    buy_9bid_req: str | None = Field(None, alias='buy_9bid_req', description='매수9호가잔량 — 단위: 1주')
    buy_10bid_req: str | None = Field(None, alias='buy_10bid_req', description='매수10호가잔량 — 단위: 1주')
    sel_1bid_jub_pre: str | None = Field(None, alias='sel_1bid_jub_pre', description='매도1호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_2bid_jub_pre: str | None = Field(None, alias='sel_2bid_jub_pre', description='매도2호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_3bid_jub_pre: str | None = Field(None, alias='sel_3bid_jub_pre', description='매도3호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_4bid_jub_pre: str | None = Field(None, alias='sel_4bid_jub_pre', description='매도4호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_5bid_jub_pre: str | None = Field(None, alias='sel_5bid_jub_pre', description='매도5호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_6bid_jub_pre: str | None = Field(None, alias='sel_6bid_jub_pre', description='매도6호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_7bid_jub_pre: str | None = Field(None, alias='sel_7bid_jub_pre', description='매도7호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_8bid_jub_pre: str | None = Field(None, alias='sel_8bid_jub_pre', description='매도8호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_9bid_jub_pre: str | None = Field(None, alias='sel_9bid_jub_pre', description='매도9호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_10bid_jub_pre: str | None = Field(None, alias='sel_10bid_jub_pre', description='매도10호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_1bid_jub_pre: str | None = Field(None, alias='buy_1bid_jub_pre', description='매수1호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_2bid_jub_pre: str | None = Field(None, alias='buy_2bid_jub_pre', description='매수2호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_3bid_jub_pre: str | None = Field(None, alias='buy_3bid_jub_pre', description='매수3호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_4bid_jub_pre: str | None = Field(None, alias='buy_4bid_jub_pre', description='매수4호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_5bid_jub_pre: str | None = Field(None, alias='buy_5bid_jub_pre', description='매수5호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_6bid_jub_pre: str | None = Field(None, alias='buy_6bid_jub_pre', description='매수6호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_7bid_jub_pre: str | None = Field(None, alias='buy_7bid_jub_pre', description='매수7호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_8bid_jub_pre: str | None = Field(None, alias='buy_8bid_jub_pre', description='매수8호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_9bid_jub_pre: str | None = Field(None, alias='buy_9bid_jub_pre', description='매수9호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_10bid_jub_pre: str | None = Field(None, alias='buy_10bid_jub_pre', description='매수10호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_1bid_cnt: str | None = Field(None, alias='sel_1bid_cnt', description='매도1호가건수')
    sel_2bid_cnt: str | None = Field(None, alias='sel_2bid_cnt', description='매도2호가건수')
    sel_3bid_cnt: str | None = Field(None, alias='sel_3bid_cnt', description='매도3호가건수')
    sel_4bid_cnt: str | None = Field(None, alias='sel_4bid_cnt', description='매도4호가건수')
    sel_5bid_cnt: str | None = Field(None, alias='sel_5bid_cnt', description='매도5호가건수')
    buy_1bid_cnt: str | None = Field(None, alias='buy_1bid_cnt', description='매수1호가건수')
    buy_2bid_cnt: str | None = Field(None, alias='buy_2bid_cnt', description='매수2호가건수')
    buy_3bid_cnt: str | None = Field(None, alias='buy_3bid_cnt', description='매수3호가건수')
    buy_4bid_cnt: str | None = Field(None, alias='buy_4bid_cnt', description='매수4호가건수')
    buy_5bid_cnt: str | None = Field(None, alias='buy_5bid_cnt', description='매수5호가건수')
    lpsel_1bid_req: str | None = Field(None, alias='lpsel_1bid_req', description='LP매도1호가잔량 — 단위: 1주')
    lpsel_2bid_req: str | None = Field(None, alias='lpsel_2bid_req', description='LP매도2호가잔량 — 단위: 1주')
    lpsel_3bid_req: str | None = Field(None, alias='lpsel_3bid_req', description='LP매도3호가잔량 — 단위: 1주')
    lpsel_4bid_req: str | None = Field(None, alias='lpsel_4bid_req', description='LP매도4호가잔량 — 단위: 1주')
    lpsel_5bid_req: str | None = Field(None, alias='lpsel_5bid_req', description='LP매도5호가잔량 — 단위: 1주')
    lpsel_6bid_req: str | None = Field(None, alias='lpsel_6bid_req', description='LP매도6호가잔량 — 단위: 1주')
    lpsel_7bid_req: str | None = Field(None, alias='lpsel_7bid_req', description='LP매도7호가잔량 — 단위: 1주')
    lpsel_8bid_req: str | None = Field(None, alias='lpsel_8bid_req', description='LP매도8호가잔량 — 단위: 1주')
    lpsel_9bid_req: str | None = Field(None, alias='lpsel_9bid_req', description='LP매도9호가잔량 — 단위: 1주')
    lpsel_10bid_req: str | None = Field(None, alias='lpsel_10bid_req', description='LP매도10호가잔량 — 단위: 1주')
    lpbuy_1bid_req: str | None = Field(None, alias='lpbuy_1bid_req', description='LP매수1호가잔량 — 단위: 1주')
    lpbuy_2bid_req: str | None = Field(None, alias='lpbuy_2bid_req', description='LP매수2호가잔량 — 단위: 1주')
    lpbuy_3bid_req: str | None = Field(None, alias='lpbuy_3bid_req', description='LP매수3호가잔량 — 단위: 1주')
    lpbuy_4bid_req: str | None = Field(None, alias='lpbuy_4bid_req', description='LP매수4호가잔량 — 단위: 1주')
    lpbuy_5bid_req: str | None = Field(None, alias='lpbuy_5bid_req', description='LP매수5호가잔량 — 단위: 1주')
    lpbuy_6bid_req: str | None = Field(None, alias='lpbuy_6bid_req', description='LP매수6호가잔량 — 단위: 1주')
    lpbuy_7bid_req: str | None = Field(None, alias='lpbuy_7bid_req', description='LP매수7호가잔량 — 단위: 1주')
    lpbuy_8bid_req: str | None = Field(None, alias='lpbuy_8bid_req', description='LP매수8호가잔량 — 단위: 1주')
    lpbuy_9bid_req: str | None = Field(None, alias='lpbuy_9bid_req', description='LP매수9호가잔량 — 단위: 1주')
    lpbuy_10bid_req: str | None = Field(None, alias='lpbuy_10bid_req', description='LP매수10호가잔량 — 단위: 1주')
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_cnt: str | None = Field(None, alias='tot_buy_cnt', description='총매수건수')
    tot_sel_cnt: str | None = Field(None, alias='tot_sel_cnt', description='총매도건수')


class Ka10008Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10008'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10008ResponseStkFrgnrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    chg_qty: str | None = Field(None, alias='chg_qty', description='변동수량 — 단위: 1주, 부호가 포함된 숫자')
    poss_stkcnt: str | None = Field(None, alias='poss_stkcnt', description='보유주식수 — 단위: 1주')
    wght: str | None = Field(None, alias='wght', description='비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    gain_pos_stkcnt: str | None = Field(None, alias='gain_pos_stkcnt', description='취득가능주식수 — 단위: 1주')
    frgnr_limit: str | None = Field(None, alias='frgnr_limit', description='외국인한도 — 단위: 1주')
    frgnr_limit_irds: str | None = Field(None, alias='frgnr_limit_irds', description='외국인한도증감')
    limit_exh_rt: str | None = Field(None, alias='limit_exh_rt', description='한도소진률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10008Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10008'
    stk_frgnr: list[Ka10008ResponseStkFrgnrItem] = Field(default_factory=list, alias='stk_frgnr', description='주식외국인')


class Ka10010Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10010'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10010Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10010'
    dfrt_trst_sell_qty: str | None = Field(None, alias='dfrt_trst_sell_qty', description='차익위탁매도수량')
    dfrt_trst_sell_amt: str | None = Field(None, alias='dfrt_trst_sell_amt', description='차익위탁매도금액')
    dfrt_trst_buy_qty: str | None = Field(None, alias='dfrt_trst_buy_qty', description='차익위탁매수수량')
    dfrt_trst_buy_amt: str | None = Field(None, alias='dfrt_trst_buy_amt', description='차익위탁매수금액')
    dfrt_trst_netprps_qty: str | None = Field(None, alias='dfrt_trst_netprps_qty', description='차익위탁순매수수량')
    dfrt_trst_netprps_amt: str | None = Field(None, alias='dfrt_trst_netprps_amt', description='차익위탁순매수금액')
    ndiffpro_trst_sell_qty: str | None = Field(None, alias='ndiffpro_trst_sell_qty', description='비차익위탁매도수량')
    ndiffpro_trst_sell_amt: str | None = Field(None, alias='ndiffpro_trst_sell_amt', description='비차익위탁매도금액')
    ndiffpro_trst_buy_qty: str | None = Field(None, alias='ndiffpro_trst_buy_qty', description='비차익위탁매수수량')
    ndiffpro_trst_buy_amt: str | None = Field(None, alias='ndiffpro_trst_buy_amt', description='비차익위탁매수금액')
    ndiffpro_trst_netprps_qty: str | None = Field(None, alias='ndiffpro_trst_netprps_qty', description='비차익위탁순매수수량')
    ndiffpro_trst_netprps_amt: str | None = Field(None, alias='ndiffpro_trst_netprps_amt', description='비차익위탁순매수금액')
    all_dfrt_trst_sell_qty: str | None = Field(None, alias='all_dfrt_trst_sell_qty', description='전체차익위탁매도수량')
    all_dfrt_trst_sell_amt: str | None = Field(None, alias='all_dfrt_trst_sell_amt', description='전체차익위탁매도금액')
    all_dfrt_trst_buy_qty: str | None = Field(None, alias='all_dfrt_trst_buy_qty', description='전체차익위탁매수수량')
    all_dfrt_trst_buy_amt: str | None = Field(None, alias='all_dfrt_trst_buy_amt', description='전체차익위탁매수금액')
    all_dfrt_trst_netprps_qty: str | None = Field(None, alias='all_dfrt_trst_netprps_qty', description='전체차익위탁순매수수량')
    all_dfrt_trst_netprps_amt: str | None = Field(None, alias='all_dfrt_trst_netprps_amt', description='전체차익위탁순매수금액')


class Ka10011Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10011'
    newstk_recvrht_tp: str = Field(..., alias='newstk_recvrht_tp', description='신주인수권구분 — 00:전체, 05:신주인수권증권, 07:신주인수권증서')


class Ka10011ResponseNewstkRecvrhtMrprItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    fpr_sel_bid: str | None = Field(None, alias='fpr_sel_bid', description='최우선매도호가 — 단위: 원, 부호가 포함된 숫자')
    fpr_buy_bid: str | None = Field(None, alias='fpr_buy_bid', description='최우선매수호가 — 단위: 원, 부호가 포함된 숫자')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')


class Ka10011Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10011'
    newstk_recvrht_mrpr: list[Ka10011ResponseNewstkRecvrhtMrprItem] = Field(default_factory=list, alias='newstk_recvrht_mrpr', description='신주인수권시세')


class Ka10013Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10013'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    dt: str = Field(..., alias='dt', description='일자 — YYYYMMDD')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 1:융자, 2:대주')


class Ka10013ResponseCrdTrdeTrendItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    new: str | None = Field(None, alias='new', description='신규 — 융자단위: 백만원, 대주단위: 백만주')
    rpya: str | None = Field(None, alias='rpya', description='상환 — 융자단위: 백만원, 대주단위: 백만주')
    remn: str | None = Field(None, alias='remn', description='잔고 — 융자단위: 백만원, 대주단위: 백만주')
    amt: str | None = Field(None, alias='amt', description='금액 — 융자단위: 백만원, 대주단위: 백만주')
    pre: str | None = Field(None, alias='pre', description='대비 — 융자단위: 백만원, 대주단위: 백만주, 부호가 포함된 숫자')
    shr_rt: str | None = Field(None, alias='shr_rt', description='공여율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    remn_rt: str | None = Field(None, alias='remn_rt', description='잔고율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10013Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10013'
    crd_trde_trend: list[Ka10013ResponseCrdTrdeTrendItem] = Field(default_factory=list, alias='crd_trde_trend', description='신용매매동향')


class Ka10014Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10014'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    tm_tp: str | None = Field(None, alias='tm_tp', description='시간구분 — 0:시작일, 1:기간')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')


class Ka10014ResponseShrtsTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    shrts_qty: str | None = Field(None, alias='shrts_qty', description='공매도량 — 단위: 1주')
    ovr_shrts_qty: str | None = Field(None, alias='ovr_shrts_qty', description='누적공매도량 — 설정 기간의 공매도량 합산데이터')
    trde_wght: str | None = Field(None, alias='trde_wght', description='매매비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    shrts_trde_prica: str | None = Field(None, alias='shrts_trde_prica', description='공매도거래대금 — 단위: 천원')
    shrts_avg_pric: str | None = Field(None, alias='shrts_avg_pric', description='공매도평균가 — 단위: 원')


class Ka10014Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10014'
    shrts_trnsn: list[Ka10014ResponseShrtsTrnsnItem] = Field(default_factory=list, alias='shrts_trnsn', description='공매도추이')


class Ka10015Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10015'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYMMDD, 시작일자 기준으로 이전 일별 거래 정보를 조회')


class Ka10015ResponseDalyTrdeDtlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    bf_mkrt_trde_qty: str | None = Field(None, alias='bf_mkrt_trde_qty', description='장전거래량 — 단위: 1주')
    bf_mkrt_trde_wght: str | None = Field(None, alias='bf_mkrt_trde_wght', description='장전거래비중 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    opmr_trde_qty: str | None = Field(None, alias='opmr_trde_qty', description='장중거래량 — 단위: 1주')
    opmr_trde_wght: str | None = Field(None, alias='opmr_trde_wght', description='장중거래비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    af_mkrt_trde_qty: str | None = Field(None, alias='af_mkrt_trde_qty', description='장후거래량 — 단위: 1주')
    af_mkrt_trde_wght: str | None = Field(None, alias='af_mkrt_trde_wght', description='장후거래비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    tot_3: str | None = Field(None, alias='tot_3', description='합계3')
    prid_trde_qty: str | None = Field(None, alias='prid_trde_qty', description='기간중거래량')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도')
    for_poss: str | None = Field(None, alias='for_poss', description='외인보유')
    for_wght: str | None = Field(None, alias='for_wght', description='외인비중')
    for_netprps: str | None = Field(None, alias='for_netprps', description='외인순매수')
    orgn_netprps: str | None = Field(None, alias='orgn_netprps', description='기관순매수')
    ind_netprps: str | None = Field(None, alias='ind_netprps', description='개인순매수')
    frgn: str | None = Field(None, alias='frgn', description='외국계')
    crd_remn_rt: str | None = Field(None, alias='crd_remn_rt', description='신용잔고율')
    prm: str | None = Field(None, alias='prm', description='프로그램')
    bf_mkrt_trde_prica: str | None = Field(None, alias='bf_mkrt_trde_prica', description='장전거래대금 — 단위: 백만원')
    bf_mkrt_trde_prica_wght: str | None = Field(None, alias='bf_mkrt_trde_prica_wght', description='장전거래대금비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    opmr_trde_prica: str | None = Field(None, alias='opmr_trde_prica', description='장중거래대금 — 단위: 백만원')
    opmr_trde_prica_wght: str | None = Field(None, alias='opmr_trde_prica_wght', description='장중거래대금비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    af_mkrt_trde_prica: str | None = Field(None, alias='af_mkrt_trde_prica', description='장후거래대금 — 단위: 백만원')
    af_mkrt_trde_prica_wght: str | None = Field(None, alias='af_mkrt_trde_prica_wght', description='장후거래대금비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10015Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10015'
    daly_trde_dtl: list[Ka10015ResponseDalyTrdeDtlItem] = Field(default_factory=list, alias='daly_trde_dtl', description='일별거래상세')


class Ka10016Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10016'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    ntl_tp: str = Field(..., alias='ntl_tp', description='신고저구분 — 1:신고가,2:신저가')
    high_low_close_tp: str = Field(..., alias='high_low_close_tp', description='고저종구분 — 1:고저기준, 2:종가기준')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회,1:관리종목제외, 3:우선주제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 00000:전체조회, 00010:만주이상, 00050:5만주이상, 00100:10만주이상, 00150:15만주이상, 00200:20만주이상, 00300:30만주이상, 00500:50만주이상, 01000:백만주이상')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    updown_incls: str = Field(..., alias='updown_incls', description='상하한포함 — 0:미포함, 1:포함')
    dt: str = Field(..., alias='dt', description='기간 — 5:5일, 10:10일, 20:20일, 60:60일, 250:250일, 250일까지 입력가능')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10016ResponseNtlPricItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    pred_trde_qty_pre_rt: str | None = Field(None, alias='pred_trde_qty_pre_rt', description='전일거래량대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')


class Ka10016Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10016'
    ntl_pric: list[Ka10016ResponseNtlPricItem] = Field(default_factory=list, alias='ntl_pric', description='신고저가')


class Ka10017Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10017'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    updown_tp: str = Field(..., alias='updown_tp', description='상하한구분 — 1:상한, 2:상승, 3:보합, 4: 하한, 5:하락, 6:전일상한, 7:전일하한')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:종목코드순, 2:연속횟수순(상위100개), 3:등락률순')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회,1:관리종목제외, 3:우선주제외, 4:우선주+관리종목제외, 5:증100제외, 6:증100만 보기, 7:증40만 보기, 8:증30만 보기, 9:증20만 보기, 10:우선주+관리종목+환기종목제외')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 00000:전체조회, 00010:만주이상, 00050:5만주이상, 00100:10만주이상, 00150:15만주이상, 00200:20만주이상, 00300:30만주이상, 00500:50만주이상, 01000:백만주이상')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    trde_gold_tp: str = Field(..., alias='trde_gold_tp', description='매매금구분 — 0:전체조회, 1:1천원미만, 2:1천원~2천원, 3:2천원~3천원, 4:5천원~1만원, 5:1만원이상, 8:1천원이상')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10017ResponseUpdownPricItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_infr: str | None = Field(None, alias='stk_infr', description='종목정보')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    pred_trde_qty: str | None = Field(None, alias='pred_trde_qty', description='전일거래량 — 단위: 1주')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')
    cnt: str | None = Field(None, alias='cnt', description='횟수')


class Ka10017Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10017'
    updown_pric: list[Ka10017ResponseUpdownPricItem] = Field(default_factory=list, alias='updown_pric', description='상하한가')


class Ka10018Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10018'
    high_low_tp: str = Field(..., alias='high_low_tp', description='고저구분 — 1:고가, 2:저가')
    alacc_rt: str = Field(..., alias='alacc_rt', description='근접율 — 05:0.5 10:1.0, 15:1.5, 20:2.0. 25:2.5, 30:3.0')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 00000:전체조회, 00010:만주이상, 00050:5만주이상, 00100:10만주이상, 00150:15만주이상, 00200:20만주이상, 00300:30만주이상, 00500:50만주이상, 01000:백만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회,1:관리종목제외, 3:우선주제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10018ResponseHighLowPricAlaccItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    tdy_high_pric: str | None = Field(None, alias='tdy_high_pric', description='당일고가 — 단위: 원, 부호가 포함된 숫자')
    tdy_low_pric: str | None = Field(None, alias='tdy_low_pric', description='당일저가 — 단위: 원, 부호가 포함된 숫자')


class Ka10018Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10018'
    high_low_pric_alacc: list[Ka10018ResponseHighLowPricAlaccItem] = Field(default_factory=list, alias='high_low_pric_alacc', description='고저가근접')


class Ka10019Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10019'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥, 201:코스피200')
    flu_tp: str = Field(..., alias='flu_tp', description='등락구분 — 1:급등, 2:급락')
    tm_tp: str = Field(..., alias='tm_tp', description='시간구분 — 1:분전, 2:일전')
    tm: str = Field(..., alias='tm', description='시간 — 분 혹은 일입력')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 00000:전체조회, 00010:만주이상, 00050:5만주이상, 00100:10만주이상, 00150:15만주이상, 00200:20만주이상, 00300:30만주이상, 00500:50만주이상, 01000:백만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회,1:관리종목제외, 3:우선주제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    pric_cnd: str = Field(..., alias='pric_cnd', description='가격조건 — 0:전체조회, 1:1천원미만, 2:1천원~2천원, 3:2천원~3천원, 4:5천원~1만원, 5:1만원이상, 8:1천원이상')
    updown_incls: str = Field(..., alias='updown_incls', description='상하한포함 — 0:미포함, 1:포함')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10019ResponsePricJmpfluItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_cls: str | None = Field(None, alias='stk_cls', description='종목분류')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    base_pre: str | None = Field(None, alias='base_pre', description='기준대비 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    jmp_rt: str | None = Field(None, alias='jmp_rt', description='급등률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10019Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10019'
    pric_jmpflu: list[Ka10019ResponsePricJmpfluItem] = Field(default_factory=list, alias='pric_jmpflu', description='가격급등락')


class Ka10020Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10020'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:순매수잔량순, 2:순매도잔량순, 3:매수비율순, 4:매도비율순')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0000:장시작전(0주이상), 0010:만주이상, 0050:5만주이상, 00100:10만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10020ResponseBidReqUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')
    netprps_req: str | None = Field(None, alias='netprps_req', description='순매수잔량 — 단위: 1주')
    buy_rt: str | None = Field(None, alias='buy_rt', description='매수비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Ka10020Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10020'
    bid_req_upper: list[Ka10020ResponseBidReqUpperItem] = Field(default_factory=list, alias='bid_req_upper', description='호가잔량상위')


class Ka10021Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10021'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:매수잔량, 2:매도잔량')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:급증량, 2:급증률')
    tm_tp: str = Field(..., alias='tm_tp', description='시간구분 — 분 입력')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 1:천주이상, 5:5천주이상, 10:만주이상, 50:5만주이상, 100:10만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10021ResponseBidReqSdninItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    int_: str | None = Field(None, alias='int', description='기준량 — 단위: 1주')
    now: str | None = Field(None, alias='now', description='현재 — 단위: 1주')
    sdnin_qty: str | None = Field(None, alias='sdnin_qty', description='급증수량 — 단위: 1주')
    sdnin_rt: str | None = Field(None, alias='sdnin_rt', description='급증률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    tot_buy_qty: str | None = Field(None, alias='tot_buy_qty', description='총매수량 — 단위: 1주')


class Ka10021Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10021'
    bid_req_sdnin: list[Ka10021ResponseBidReqSdninItem] = Field(default_factory=list, alias='bid_req_sdnin', description='호가잔량급증')


class Ka10022Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10022'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')
    rt_tp: str = Field(..., alias='rt_tp', description='비율구분 — 1:매수/매도비율, 2:매도/매수비율')
    tm_tp: str = Field(..., alias='tm_tp', description='시간구분 — 분 입력')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 5:5천주이상, 10:만주이상, 50:5만주이상, 100:10만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10022ResponseReqRtSdninItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    int_: str | None = Field(None, alias='int', description='기준률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    now_rt: str | None = Field(None, alias='now_rt', description='현재비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    sdnin_rt: str | None = Field(None, alias='sdnin_rt', description='급증률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')


class Ka10022Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10022'
    req_rt_sdnin: list[Ka10022ResponseReqRtSdninItem] = Field(default_factory=list, alias='req_rt_sdnin', description='잔량율급증')


class Ka10023Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10023'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:급증량, 2:급증률, 3:급감량, 4:급감률')
    tm_tp: str = Field(..., alias='tm_tp', description='시간구분 — 1:분, 2:전일')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 5:5천주이상, 10:만주이상, 50:5만주이상, 100:10만주이상, 200:20만주이상, 300:30만주이상, 500:50만주이상, 1000:백만주이상')
    tm: str | None = Field(None, alias='tm', description='시간 — 분 입력')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 3:우선주제외, 11:정리매매종목제외, 4:관리종목,우선주제외, 5:증100제외, 6:증100만보기, 13:증60만보기, 12:증50만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기, 17:ETN제외, 14:ETF제외, 18:ETF+ETN제외, 15:스팩제외, 20:ETF+ETN+스팩제외')
    pric_tp: str = Field(..., alias='pric_tp', description='가격구분 — 0:전체조회, 2:5만원이상, 5:1만원이상, 6:5천원이상, 8:1천원이상, 9:10만원이상')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10023ResponseTrdeQtySdninItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    prev_trde_qty: str | None = Field(None, alias='prev_trde_qty', description='이전거래량 — 단위: 1주')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    sdnin_qty: str | None = Field(None, alias='sdnin_qty', description='급증량 — 단위: 1주, 부호가 포함된 숫자')
    sdnin_rt: str | None = Field(None, alias='sdnin_rt', description='급증률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10023Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10023'
    trde_qty_sdnin: list[Ka10023ResponseTrdeQtySdninItem] = Field(default_factory=list, alias='trde_qty_sdnin', description='거래량급증')


class Ka10024Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10024'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    cycle_tp: str = Field(..., alias='cycle_tp', description='주기구분 — 5:5일, 10:10일, 20:20일, 60:60일, 250:250일')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 5:5천주이상, 10:만주이상, 50:5만주이상, 100:10만주이상, 200:20만주이상, 300:30만주이상, 500:50만주이상, 1000:백만주이상')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10024ResponseTrdeQtyUpdtItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    prev_trde_qty: str | None = Field(None, alias='prev_trde_qty', description='이전거래량 — 단위: 1주')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')


class Ka10024Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10024'
    trde_qty_updt: list[Ka10024ResponseTrdeQtyUpdtItem] = Field(default_factory=list, alias='trde_qty_updt', description='거래량갱신')


class Ka10025Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10025'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    prps_cnctr_rt: str = Field(..., alias='prps_cnctr_rt', description='매물집중비율 — 0~100 입력')
    cur_prc_entry: str = Field(..., alias='cur_prc_entry', description='현재가진입 — 0:현재가 매물대 진입 포함안함, 1:현재가 매물대 진입포함')
    prpscnt: str = Field(..., alias='prpscnt', description='매물대수 — 숫자입력')
    cycle_tp: str = Field(..., alias='cycle_tp', description='주기구분 — 50:50일, 100:100일, 150:150일, 200:200일, 250:250일, 300:300일')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10025ResponsePrpsCnctrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    pric_strt: str | None = Field(None, alias='pric_strt', description='가격대시작 — 단위: 원')
    pric_end: str | None = Field(None, alias='pric_end', description='가격대끝 — 단위: 원')
    prps_qty: str | None = Field(None, alias='prps_qty', description='매물량 — 단위: 1주')
    prps_rt: str | None = Field(None, alias='prps_rt', description='매물비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10025Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10025'
    prps_cnctr: list[Ka10025ResponsePrpsCnctrItem] = Field(default_factory=list, alias='prps_cnctr', description='매물대집중')


class Ka10026Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10026'
    pertp: str = Field(..., alias='pertp', description='PER구분 — 1:저PBR, 2:고PBR, 3:저PER, 4:고PER, 5:저ROE, 6:고ROE')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10026ResponseHighLowPerItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    per: str | None = Field(None, alias='per', description='PER')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')


class Ka10026Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10026'
    high_low_per: list[Ka10026ResponseHighLowPerItem] = Field(default_factory=list, alias='high_low_per', description='고저PER')


class Ka10027Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10027'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:상승률, 2:상승폭, 3:하락률, 4:하락폭, 5:보합')
    trde_qty_cnd: str = Field(..., alias='trde_qty_cnd', description='거래량조건 — 0000:전체조회, 0010:만주이상, 0050:5만주이상, 0100:10만주이상, 0150:15만주이상, 0200:20만주이상, 0300:30만주이상, 0500:50만주이상, 1000:백만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 4:우선주+관리주제외, 3:우선주제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기, 11:정리매매종목제외, 12:증50만보기, 13:증60만보기, 14:ETF제외, 15:스펙제외, 16:ETF+ETN제외')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    updown_incls: str = Field(..., alias='updown_incls', description='상하한포함 — 0:불 포함, 1:포함')
    pric_cnd: str = Field(..., alias='pric_cnd', description='가격조건 — 0:전체조회, 1:1천원미만, 2:1천원~2천원, 3:2천원~5천원, 4:5천원~1만원, 5:1만원이상, 8:1천원이상, 10: 1만원미만')
    trde_prica_cnd: str = Field(..., alias='trde_prica_cnd', description='거래대금조건 — 0:전체조회, 3:3천만원이상, 5:5천만원이상, 10:1억원이상, 30:3억원이상, 50:5억원이상, 100:10억원이상, 300:30억원이상, 500:50억원이상, 1000:100억원이상, 3000:300억원이상, 5000:500억원이상')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10027ResponsePredPreFluRtUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cls: str | None = Field(None, alias='stk_cls', description='종목분류')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cnt: str | None = Field(None, alias='cnt', description='횟수')


class Ka10027Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10027'
    pred_pre_flu_rt_upper: list[Ka10027ResponsePredPreFluRtUpperItem] = Field(default_factory=list, alias='pred_pre_flu_rt_upper', description='전일대비등락률상위')


class Ka10028Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10028'
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:시가, 2:고가, 3:저가, 4:기준가')
    trde_qty_cnd: str = Field(..., alias='trde_qty_cnd', description='거래량조건 — 0000:전체조회, 0010:만주이상, 0050:5만주이상, 0100:10만주이상, 0500:50만주이상, 1000:백만주이상')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    updown_incls: str = Field(..., alias='updown_incls', description='상하한포함 — 0:불 포함, 1:포함')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 4:우선주+관리주제외, 3:우선주제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    trde_prica_cnd: str = Field(..., alias='trde_prica_cnd', description='거래대금조건 — 0:전체조회, 3:3천만원이상, 5:5천만원이상, 10:1억원이상, 30:3억원이상, 50:5억원이상, 100:10억원이상, 300:30억원이상, 500:50억원이상, 1000:100억원이상, 3000:300억원이상, 5000:500억원이상')
    flu_cnd: str = Field(..., alias='flu_cnd', description='등락조건 — 1:상위, 2:하위')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10028ResponseOpenPricPreFluRtItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    open_pric_pre: str | None = Field(None, alias='open_pric_pre', description='시가대비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Ka10028Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10028'
    open_pric_pre_flu_rt: list[Ka10028ResponseOpenPricPreFluRtItem] = Field(default_factory=list, alias='open_pric_pre_flu_rt', description='시가대비등락률')


class Ka10029Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10029'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:상승률, 2:상승폭, 3:보합, 4:하락률, 5:하락폭, 6:체결량, 7:상한, 8:하한')
    trde_qty_cnd: str = Field(..., alias='trde_qty_cnd', description='거래량조건 — 0:전체조회, 1;천주이상, 3:3천주, 5:5천주, 10:만주이상, 50:5만주이상, 100:10만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 3:우선주제외, 4:관리종목,우선주제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기, 11:정리매매종목제외, 12:증50만보기, 13:증60만보기, 14:ETF제외, 15:스팩제외, 16:ETF+ETN제외')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 5:신용한도초과제외, 7:신용융자E군, 8:신용대주, 9:신용융자전체')
    pric_cnd: str = Field(..., alias='pric_cnd', description='가격조건 — 0:전체조회, 1:1천원미만, 2:1천원~2천원, 3:2천원~5천원, 4:5천원~1만원, 5:1만원이상, 8:1천원이상, 10:1만원미만')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10029ResponseExpCntrFluRtUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상체결가 — 단위: 원, 부호가 포함된 숫자')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    exp_cntr_qty: str | None = Field(None, alias='exp_cntr_qty', description='예상체결량 — 단위: 1주')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')


class Ka10029Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10029'
    exp_cntr_flu_rt_upper: list[Ka10029ResponseExpCntrFluRtUpperItem] = Field(default_factory=list, alias='exp_cntr_flu_rt_upper', description='예상체결등락률상위')


class Ka10030Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10030'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:거래량, 2:거래회전율, 3:거래대금')
    mang_stk_incls: str = Field(..., alias='mang_stk_incls', description='관리종목포함 — 0:관리종목 포함, 1:관리종목 미포함, 3:우선주제외, 11:정리매매종목제외, 4:관리종목, 우선주제외, 5:증100제외, 6:증100마나보기, 13:증60만보기, 12:증50만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기, 14:ETF제외, 15:스팩제외, 16:ETF+ETN제외')
    crd_tp: str = Field(..., alias='crd_tp', description='신용구분 — 0:전체조회, 9:신용융자전체, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 8:신용대주')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0:전체조회, 5:5천주이상, 10:1만주이상, 50:5만주이상, 100:10만주이상, 200:20만주이상, 300:30만주이상, 500:500만주이상, 1000:백만주이상')
    pric_tp: str = Field(..., alias='pric_tp', description='가격구분 — 0:전체조회, 1:1천원미만, 2:1천원이상, 3:1천원~2천원, 4:2천원~5천원, 5:5천원이상, 6:5천원~1만원, 10:1만원미만, 7:1만원이상, 8:5만원이상, 9:10만원이상')
    trde_prica_tp: str = Field(..., alias='trde_prica_tp', description='거래대금구분 — 0:전체조회, 1:1천만원이상, 3:3천만원이상, 4:5천만원이상, 10:1억원이상, 30:3억원이상, 50:5억원이상, 100:10억원이상, 300:30억원이상, 500:50억원이상, 1000:100억원이상, 3000:300억원이상, 5000:500억원이상')
    mrkt_open_tp: str = Field(..., alias='mrkt_open_tp', description='장운영구분 — 0:전체조회, 1:장중, 2:장전시간외, 3:장후시간외')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10030ResponseTdyTrdeQtyUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    pred_rt: str | None = Field(None, alias='pred_rt', description='전일비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_tern_rt: str | None = Field(None, alias='trde_tern_rt', description='거래회전율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_amt: str | None = Field(None, alias='trde_amt', description='거래금액 — 단위: 백만원')
    opmr_trde_qty: str | None = Field(None, alias='opmr_trde_qty', description='장중거래량')
    opmr_pred_rt: str | None = Field(None, alias='opmr_pred_rt', description='장중전일비')
    opmr_trde_rt: str | None = Field(None, alias='opmr_trde_rt', description='장중거래회전율')
    opmr_trde_amt: str | None = Field(None, alias='opmr_trde_amt', description='장중거래금액')
    af_mkrt_trde_qty: str | None = Field(None, alias='af_mkrt_trde_qty', description='장후거래량')
    af_mkrt_pred_rt: str | None = Field(None, alias='af_mkrt_pred_rt', description='장후전일비')
    af_mkrt_trde_rt: str | None = Field(None, alias='af_mkrt_trde_rt', description='장후거래회전율')
    af_mkrt_trde_amt: str | None = Field(None, alias='af_mkrt_trde_amt', description='장후거래금액')
    bf_mkrt_trde_qty: str | None = Field(None, alias='bf_mkrt_trde_qty', description='장전거래량')
    bf_mkrt_pred_rt: str | None = Field(None, alias='bf_mkrt_pred_rt', description='장전전일비')
    bf_mkrt_trde_rt: str | None = Field(None, alias='bf_mkrt_trde_rt', description='장전거래회전율')
    bf_mkrt_trde_amt: str | None = Field(None, alias='bf_mkrt_trde_amt', description='장전거래금액')


class Ka10030Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10030'
    tdy_trde_qty_upper: list[Ka10030ResponseTdyTrdeQtyUpperItem] = Field(default_factory=list, alias='tdy_trde_qty_upper', description='당일거래량상위')


class Ka10031Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10031'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 1:전일거래량 상위100종목, 2:전일거래대금 상위100종목')
    rank_strt: str = Field(..., alias='rank_strt', description='순위시작 — 0 ~ 100 값 중에  조회를 원하는 순위 시작값')
    rank_end: str = Field(..., alias='rank_end', description='순위끝 — 0 ~ 100 값 중에  조회를 원하는 순위 끝값')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10031ResponsePredTrdeQtyUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')


class Ka10031Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10031'
    pred_trde_qty_upper: list[Ka10031ResponsePredTrdeQtyUpperItem] = Field(default_factory=list, alias='pred_trde_qty_upper', description='전일거래량상위')


class Ka10032Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10032'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    mang_stk_incls: str = Field(..., alias='mang_stk_incls', description='관리종목포함 — 0:관리종목 미포함, 1:관리종목 포함')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10032ResponseTrdePricaUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    now_rank: str | None = Field(None, alias='now_rank', description='현재순위')
    pred_rank: str | None = Field(None, alias='pred_rank', description='전일순위')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    pred_trde_qty: str | None = Field(None, alias='pred_trde_qty', description='전일거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka10032Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10032'
    trde_prica_upper: list[Ka10032ResponseTrdePricaUpperItem] = Field(default_factory=list, alias='trde_prica_upper', description='거래대금상위')


class Ka10033Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10033'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0:전체조회, 10:만주이상, 50:5만주이상, 100:10만주이상, 200:20만주이상, 300:30만주이상, 500:50만주이상, 1000:백만주이상')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회, 1:관리종목제외, 5:증100제외, 6:증100만보기, 7:증40만보기, 8:증30만보기, 9:증20만보기')
    updown_incls: str = Field(..., alias='updown_incls', description='상하한포함 — 0:상하한 미포함, 1:상하한포함')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 9:신용융자전체')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10033ResponseCrdRtUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_infr: str | None = Field(None, alias='stk_infr', description='종목정보')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    crd_rt: str | None = Field(None, alias='crd_rt', description='신용비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')


class Ka10033Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10033'
    crd_rt_upper: list[Ka10033ResponseCrdRtUpperItem] = Field(default_factory=list, alias='crd_rt_upper', description='신용비율상위')


class Ka10034Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10034'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매도, 2:순매수, 3:순매매')
    dt: str = Field(..., alias='dt', description='기간 — 0:당일, 1:전일, 5:5일, 10;10일, 20:20일, 60:60일')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka10034ResponseForDtTrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    netprps_qty: str | None = Field(None, alias='netprps_qty', description='순매수량 — 단위: 1주, 부호가 포함된 숫자')
    gain_pos_stkcnt: str | None = Field(None, alias='gain_pos_stkcnt', description='취득가능주식수 — 단위: 1주')


class Ka10034Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10034'
    for_dt_trde_upper: list[Ka10034ResponseForDtTrdeUpperItem] = Field(default_factory=list, alias='for_dt_trde_upper', description='외인기간별매매상위')


class Ka10035Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10035'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:연속순매도, 2:연속순매수')
    base_dt_tp: str = Field(..., alias='base_dt_tp', description='기준일구분 — 0:당일기준, 1:전일기준')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka10035ResponseForContNettrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    dm1: str | None = Field(None, alias='dm1', description='D-1 — 단위: 1주, 부호가 포함된 숫자')
    dm2: str | None = Field(None, alias='dm2', description='D-2 — 단위: 1주, 부호가 포함된 숫자')
    dm3: str | None = Field(None, alias='dm3', description='D-3 — 단위: 1주, 부호가 포함된 숫자')
    tot: str | None = Field(None, alias='tot', description='합계 — 단위: 1주, 부호가 포함된 숫자')
    limit_exh_rt: str | None = Field(None, alias='limit_exh_rt', description='한도소진율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pred_pre_1: str | None = Field(None, alias='pred_pre_1', description='전일대비1')
    pred_pre_2: str | None = Field(None, alias='pred_pre_2', description='전일대비2')
    pred_pre_3: str | None = Field(None, alias='pred_pre_3', description='전일대비3')


class Ka10035Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10035'
    for_cont_nettrde_upper: list[Ka10035ResponseForContNettrdeUpperItem] = Field(default_factory=list, alias='for_cont_nettrde_upper', description='외인연속순매매상위')


class Ka10036Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10036'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    dt: str = Field(..., alias='dt', description='기간 — 0:당일, 1:전일, 5:5일, 10;10일, 20:20일, 60:60일')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka10036ResponseForLimitExhRtIncrsUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    poss_stkcnt: str | None = Field(None, alias='poss_stkcnt', description='보유주식수 — 단위: 1주')
    gain_pos_stkcnt: str | None = Field(None, alias='gain_pos_stkcnt', description='취득가능주식수 — 단위: 1주')
    base_limit_exh_rt: str | None = Field(None, alias='base_limit_exh_rt', description='기준한도소진율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    limit_exh_rt: str | None = Field(None, alias='limit_exh_rt', description='한도소진율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    exh_rt_incrs: str | None = Field(None, alias='exh_rt_incrs', description='소진율증가 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10036Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10036'
    for_limit_exh_rt_incrs_upper: list[Ka10036ResponseForLimitExhRtIncrsUpperItem] = Field(default_factory=list, alias='for_limit_exh_rt_incrs_upper', description='외인한도소진율증가상위')


class Ka10037Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10037'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    dt: str = Field(..., alias='dt', description='기간 — 0:당일, 1:전일, 5:5일, 10;10일, 20:20일, 60:60일')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매수, 2:순매도, 3:매수, 4:매도')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:금액, 2:수량')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka10037ResponseFrgnWicketTrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_trde_qty: str | None = Field(None, alias='sel_trde_qty', description='매도거래량 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_qty: str | None = Field(None, alias='buy_trde_qty', description='매수거래량 — 단위: 1주, 부호가 포함된 숫자')
    netprps_trde_qty: str | None = Field(None, alias='netprps_trde_qty', description='순매수거래량 — 단위: 1주, 부호가 포함된 숫자')
    netprps_prica: str | None = Field(None, alias='netprps_prica', description='순매수대금 — 단위: 백만원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka10037Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10037'
    frgn_wicket_trde_upper: list[Ka10037ResponseFrgnWicketTrdeUpperItem] = Field(default_factory=list, alias='frgn_wicket_trde_upper', description='외국계창구매매상위')


class Ka10038Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10038'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str | None = Field(None, alias='strt_dt', description='시작일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 1:순매도순위정렬, 2:순매수순위정렬')
    dt: str | None = Field(None, alias='dt', description="기간 — 1:전일, 4:5일, 9:10일, 19:20일, 39:40일, 59:60일, 119:120일\n\n※ 시작일자와 종료일자로 조회를 원하는 경우 기간(dt)값은 빈값('')으로 설정")


class Ka10038ResponseStkSecRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    mmcm_nm: str | None = Field(None, alias='mmcm_nm', description='회원사명')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량 — 단위: 1주, 부호가 포함된 숫자')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량 — 단위: 1주, 부호가 포함된 숫자')
    acc_netprps_qty: str | None = Field(None, alias='acc_netprps_qty', description='누적순매수수량 — 단위: 1주, 부호가 포함된 숫자')


class Ka10038Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10038'
    rank_1: str | None = Field(None, alias='rank_1', description='기간별 누적 매수량 — 단위: 1주, 부호가 포함된 숫자')
    rank_2: str | None = Field(None, alias='rank_2', description='기간별 누적 매도량 — 단위: 1주, 부호가 포함된 숫자')
    rank_3: str | None = Field(None, alias='rank_3', description='기간별 누적 순매수 — 단위: 1주, 부호가 포함된 숫자')
    prid_trde_qty: str | None = Field(None, alias='prid_trde_qty', description='기간중거래량 — 단위: 1주')
    stk_sec_rank: list[Ka10038ResponseStkSecRankItem] = Field(default_factory=list, alias='stk_sec_rank', description='종목별증권사순위')


class Ka10039Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10039'
    mmcm_cd: str = Field(..., alias='mmcm_cd', description='회원사코드 — 회원사 코드는 ka10102 조회')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0:전체, 5:5000주, 10:1만주, 50:5만주, 100:10만주, 500:50만주, 1000: 100만주')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매수, 2:순매도')
    dt: str = Field(..., alias='dt', description='기간 — 0:당일, 1:전일, 5:5일, 10:10일, 60:60일')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10039ResponseSecTrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    prid_stkpc_flu: str | None = Field(None, alias='prid_stkpc_flu', description='기간중주가등락 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    prid_trde_qty: str | None = Field(None, alias='prid_trde_qty', description='기간중거래량 — 단위: 1주')
    netprps: str | None = Field(None, alias='netprps', description='순매수 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_qty: str | None = Field(None, alias='buy_trde_qty', description='매수거래량 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_qty: str | None = Field(None, alias='sel_trde_qty', description='매도거래량 — 단위: 1주, 부호가 포함된 숫자')
    netprps_amt: str | None = Field(None, alias='netprps_amt', description='순매수금액 — 단위: 천원, 부호가 포함된 숫자')
    buy_amt: str | None = Field(None, alias='buy_amt', description='매수금액 — 단위: 천원, 부호가 포함된 숫자')
    sell_amt: str | None = Field(None, alias='sell_amt', description='매도금액 — 단위: 천원, 부호가 포함된 숫자')


class Ka10039Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10039'
    sec_trde_upper: list[Ka10039ResponseSecTrdeUpperItem] = Field(default_factory=list, alias='sec_trde_upper', description='증권사별매매상위')


class Ka10040Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10040'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10040ResponseTdyMainTrdeOriItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    sel_scesn_tm: str | None = Field(None, alias='sel_scesn_tm', description='매도이탈시간')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량')
    sel_upper_scesn_ori: str | None = Field(None, alias='sel_upper_scesn_ori', description='매도상위이탈원')
    buy_scesn_tm: str | None = Field(None, alias='buy_scesn_tm', description='매수이탈시간')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량')
    buy_upper_scesn_ori: str | None = Field(None, alias='buy_upper_scesn_ori', description='매수상위이탈원')
    qry_dt: str | None = Field(None, alias='qry_dt', description='조회일자')
    qry_tm: str | None = Field(None, alias='qry_tm', description='조회시간')


class Ka10040Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10040'
    sel_trde_ori_irds_1: str | None = Field(None, alias='sel_trde_ori_irds_1', description='매도거래원별증감1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_1: str | None = Field(None, alias='sel_trde_ori_qty_1', description='매도거래원수량1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_1: str | None = Field(None, alias='sel_trde_ori_1', description='매도거래원1')
    sel_trde_ori_cd_1: str | None = Field(None, alias='sel_trde_ori_cd_1', description='매도거래원코드1')
    buy_trde_ori_1: str | None = Field(None, alias='buy_trde_ori_1', description='매수거래원1')
    buy_trde_ori_cd_1: str | None = Field(None, alias='buy_trde_ori_cd_1', description='매수거래원코드1')
    buy_trde_ori_qty_1: str | None = Field(None, alias='buy_trde_ori_qty_1', description='매수거래원수량1 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_1: str | None = Field(None, alias='buy_trde_ori_irds_1', description='매수거래원별증감1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_irds_2: str | None = Field(None, alias='sel_trde_ori_irds_2', description='매도거래원별증감2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_2: str | None = Field(None, alias='sel_trde_ori_qty_2', description='매도거래원수량2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_2: str | None = Field(None, alias='sel_trde_ori_2', description='매도거래원2')
    sel_trde_ori_cd_2: str | None = Field(None, alias='sel_trde_ori_cd_2', description='매도거래원코드2')
    buy_trde_ori_2: str | None = Field(None, alias='buy_trde_ori_2', description='매수거래원2')
    buy_trde_ori_cd_2: str | None = Field(None, alias='buy_trde_ori_cd_2', description='매수거래원코드2')
    buy_trde_ori_qty_2: str | None = Field(None, alias='buy_trde_ori_qty_2', description='매수거래원수량2 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_2: str | None = Field(None, alias='buy_trde_ori_irds_2', description='매수거래원별증감2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_irds_3: str | None = Field(None, alias='sel_trde_ori_irds_3', description='매도거래원별증감3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_3: str | None = Field(None, alias='sel_trde_ori_qty_3', description='매도거래원수량3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_3: str | None = Field(None, alias='sel_trde_ori_3', description='매도거래원3')
    sel_trde_ori_cd_3: str | None = Field(None, alias='sel_trde_ori_cd_3', description='매도거래원코드3')
    buy_trde_ori_3: str | None = Field(None, alias='buy_trde_ori_3', description='매수거래원3')
    buy_trde_ori_cd_3: str | None = Field(None, alias='buy_trde_ori_cd_3', description='매수거래원코드3')
    buy_trde_ori_qty_3: str | None = Field(None, alias='buy_trde_ori_qty_3', description='매수거래원수량3 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_3: str | None = Field(None, alias='buy_trde_ori_irds_3', description='매수거래원별증감3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_irds_4: str | None = Field(None, alias='sel_trde_ori_irds_4', description='매도거래원별증감4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_4: str | None = Field(None, alias='sel_trde_ori_qty_4', description='매도거래원수량4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_4: str | None = Field(None, alias='sel_trde_ori_4', description='매도거래원4')
    sel_trde_ori_cd_4: str | None = Field(None, alias='sel_trde_ori_cd_4', description='매도거래원코드4')
    buy_trde_ori_4: str | None = Field(None, alias='buy_trde_ori_4', description='매수거래원4')
    buy_trde_ori_cd_4: str | None = Field(None, alias='buy_trde_ori_cd_4', description='매수거래원코드4')
    buy_trde_ori_qty_4: str | None = Field(None, alias='buy_trde_ori_qty_4', description='매수거래원수량4 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_4: str | None = Field(None, alias='buy_trde_ori_irds_4', description='매수거래원별증감4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_irds_5: str | None = Field(None, alias='sel_trde_ori_irds_5', description='매도거래원별증감5 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_5: str | None = Field(None, alias='sel_trde_ori_qty_5', description='매도거래원수량5 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_5: str | None = Field(None, alias='sel_trde_ori_5', description='매도거래원5')
    sel_trde_ori_cd_5: str | None = Field(None, alias='sel_trde_ori_cd_5', description='매도거래원코드5')
    buy_trde_ori_5: str | None = Field(None, alias='buy_trde_ori_5', description='매수거래원5')
    buy_trde_ori_cd_5: str | None = Field(None, alias='buy_trde_ori_cd_5', description='매수거래원코드5')
    buy_trde_ori_qty_5: str | None = Field(None, alias='buy_trde_ori_qty_5', description='매수거래원수량5 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_5: str | None = Field(None, alias='buy_trde_ori_irds_5', description='매수거래원별증감5 — 단위: 1주, 부호가 포함된 숫자')
    frgn_sel_prsm_sum_chang: str | None = Field(None, alias='frgn_sel_prsm_sum_chang', description='외국계매도추정합변동 — 단위: 1주, 부호가 포함된 숫자')
    frgn_sel_prsm_sum: str | None = Field(None, alias='frgn_sel_prsm_sum', description='외국계매도추정합 — 단위: 1주, 부호가 포함된 숫자')
    frgn_buy_prsm_sum: str | None = Field(None, alias='frgn_buy_prsm_sum', description='외국계매수추정합 — 단위: 1주, 부호가 포함된 숫자')
    frgn_buy_prsm_sum_chang: str | None = Field(None, alias='frgn_buy_prsm_sum_chang', description='외국계매수추정합변동 — 단위: 1주, 부호가 포함된 숫자')
    tdy_main_trde_ori: list[Ka10040ResponseTdyMainTrdeOriItem] = Field(default_factory=list, alias='tdy_main_trde_ori', description='당일주요거래원')


class Ka10042Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10042'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str | None = Field(None, alias='strt_dt', description='시작일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    qry_dt_tp: str = Field(..., alias='qry_dt_tp', description='조회기간구분 — 0:기간으로 조회, 1:시작일자, 종료일자로 조회')
    pot_tp: str = Field(..., alias='pot_tp', description='시점구분 — 0:당일, 1:전일')
    dt: str | None = Field(None, alias='dt', description='기간 — 5:5일, 10:10일, 20:20일, 40:40일, 60:60일, 120:120일')
    sort_base: str = Field(..., alias='sort_base', description='정렬기준 — 1:종가순, 2:날짜순')


class Ka10042ResponseNetprpsTrdeOriRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    mmcm_cd: str | None = Field(None, alias='mmcm_cd', description='회원사코드')
    mmcm_nm: str | None = Field(None, alias='mmcm_nm', description='회원사명')


class Ka10042Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10042'
    netprps_trde_ori_rank: list[Ka10042ResponseNetprpsTrdeOriRankItem] = Field(default_factory=list, alias='netprps_trde_ori_rank', description='순매수거래원순위')


class Ka10043Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10043'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')
    qry_dt_tp: str = Field(..., alias='qry_dt_tp', description='조회기간구분 — 0:기간으로 조회, 1:시작일자, 종료일자로 조회')
    pot_tp: str = Field(..., alias='pot_tp', description='시점구분 — 0:당일, 1:전일')
    dt: str = Field(..., alias='dt', description='기간 — 5:5일, 10:10일, 20:20일, 40:40일, 60:60일, 120:120일')
    sort_base: str = Field(..., alias='sort_base', description='정렬기준 — 1:종가순, 2:날짜순')
    mmcm_cd: str = Field(..., alias='mmcm_cd', description='회원사코드 — 회원사 코드는 ka10102 조회')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10043ResponseTrdeOriPrpsAnlyItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    sel_qty: str | None = Field(None, alias='sel_qty', description='매도량 — 단위: 1주')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수량 — 단위: 1주')
    netprps_qty: str | None = Field(None, alias='netprps_qty', description='순매수수량 — 단위: 1주')
    trde_qty_sum: str | None = Field(None, alias='trde_qty_sum', description='거래량합 — 단위: 1주')
    trde_wght: str | None = Field(None, alias='trde_wght', description='거래비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10043Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10043'
    trde_ori_prps_anly: list[Ka10043ResponseTrdeOriPrpsAnlyItem] = Field(default_factory=list, alias='trde_ori_prps_anly', description='거래원매물대분석')


class Ka10044Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10044'
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매도, 2:순매수')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10044ResponseDalyOrgnTrdeStkItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    netprps_qty: str | None = Field(None, alias='netprps_qty', description='순매수수량 — 단위: 100주')
    netprps_amt: str | None = Field(None, alias='netprps_amt', description='순매수금액 — 단위: 백만원')


class Ka10044Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10044'
    daly_orgn_trde_stk: list[Ka10044ResponseDalyOrgnTrdeStkItem] = Field(default_factory=list, alias='daly_orgn_trde_stk', description='일별기관매매종목')


class Ka10045Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10045'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')
    orgn_prsm_unp_tp: str = Field(..., alias='orgn_prsm_unp_tp', description='기관추정단가구분 — 1:매수단가, 2:매도단가')
    for_prsm_unp_tp: str = Field(..., alias='for_prsm_unp_tp', description='외인추정단가구분 — 1:매수단가, 2:매도단가')


class Ka10045ResponseStkOrgnTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    orgn_dt_acc: str | None = Field(None, alias='orgn_dt_acc', description='기관기간누적')
    orgn_daly_nettrde_qty: str | None = Field(None, alias='orgn_daly_nettrde_qty', description='기관일별순매매수량 — 단위: 1주')
    for_dt_acc: str | None = Field(None, alias='for_dt_acc', description='외인기간누적')
    for_daly_nettrde_qty: str | None = Field(None, alias='for_daly_nettrde_qty', description='외인일별순매매수량 — 단위: 1주')
    limit_exh_rt: str | None = Field(None, alias='limit_exh_rt', description='한도소진율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10045Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10045'
    orgn_prsm_avg_pric: str | None = Field(None, alias='orgn_prsm_avg_pric', description='기관추정평균가 — 단위: 원')
    for_prsm_avg_pric: str | None = Field(None, alias='for_prsm_avg_pric', description='외인추정평균가 — 단위: 원')
    stk_orgn_trde_trnsn: list[Ka10045ResponseStkOrgnTrdeTrnsnItem] = Field(default_factory=list, alias='stk_orgn_trde_trnsn', description='종목별기관매매추이')


class Ka10046Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10046'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10046ResponseCntrStrTmItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str_5min: str | None = Field(None, alias='cntr_str_5min', description='체결강도5분 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str_20min: str | None = Field(None, alias='cntr_str_20min', description='체결강도20분 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str_60min: str | None = Field(None, alias='cntr_str_60min', description='체결강도60분 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분')


class Ka10046Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10046'
    cntr_str_tm: list[Ka10046ResponseCntrStrTmItem] = Field(default_factory=list, alias='cntr_str_tm', description='체결강도시간별')


class Ka10047Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10047'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10047ResponseCntrStrDalyItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str_5min: str | None = Field(None, alias='cntr_str_5min', description='체결강도5일 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str_20min: str | None = Field(None, alias='cntr_str_20min', description='체결강도20일 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str_60min: str | None = Field(None, alias='cntr_str_60min', description='체결강도60일 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Ka10047Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10047'
    cntr_str_daly: list[Ka10047ResponseCntrStrDalyItem] = Field(default_factory=list, alias='cntr_str_daly', description='체결강도일별')


class Ka10048Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10048'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka10048ResponseElwdalySnstIxItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자')
    iv: str | None = Field(None, alias='iv', description='IV — 소수점 제거 된 100배 값으로 제공\n\n예) "2658"는 26.58를 의미합니다.')
    delta: str | None = Field(None, alias='delta', description='델타 — 소수점 제거한 값으로 제공\n\n예) "590470"값은 0.590470을 의미합니다.')
    gam: str | None = Field(None, alias='gam', description='감마 — 소수점 제거한 값으로 제공\n\n예) "167"값은 0.000167을 의미합니다.')
    theta: str | None = Field(None, alias='theta', description='쎄타 — 소수점 제거한 값으로 제공\n\n예) "-991554"값은 -0.991554를 의미합니다.')
    vega: str | None = Field(None, alias='vega', description='베가 — 소수점 제거한 값으로 제공\n \n예) "-991554"값은 -0.991554를 의미합니다.')
    law: str | None = Field(None, alias='law', description='로 — 소수점 제거한 값으로 제공\n \n예) "76850"값은 0.076850을 의미합니다.')
    lp: str | None = Field(None, alias='lp', description='LP — 소수점 제거 된 100배 값으로 제공\n \n예) "6197"값은 61.87을 의미합니다.')


class Ka10048Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10048'
    elwdaly_snst_ix: list[Ka10048ResponseElwdalySnstIxItem] = Field(default_factory=list, alias='elwdaly_snst_ix', description='ELW일별민감도지표')


class Ka10050Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10050'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka10050ResponseElwsnstIxArrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    elwtheory_pric: str | None = Field(None, alias='elwtheory_pric', description='ELW이론가 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    iv: str | None = Field(None, alias='iv', description='IV — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    delta: str | None = Field(None, alias='delta', description='델타 — 소수점 제거한 값으로 제공\n \n예) "590470"값은 0.590470을 의미합니다.')
    gam: str | None = Field(None, alias='gam', description='감마 — 소수점 제거한 값으로 제공\n\n예) "163"값은 0.000163을 의미합니다.')
    theta: str | None = Field(None, alias='theta', description='쎄타 — 소수점 제거한 값으로 제공\n \n예) "-1057402"값은 -1.057402을 의미합니다.')
    vega: str | None = Field(None, alias='vega', description='베가 — 소수점 제거한 값으로 제공\n \n예) "290965"값은 0.290965을 의미합니다.')
    law: str | None = Field(None, alias='law', description='로 — 소수점 제거한 값으로 제공\n \n예) "73629"값은 0.073629을 의미합니다.')
    lp: str | None = Field(None, alias='lp', description='LP — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')


class Ka10050Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10050'
    elwsnst_ix_array: list[Ka10050ResponseElwsnstIxArrayItem] = Field(default_factory=list, alias='elwsnst_ix_array', description='ELW민감도지표배열')


class Ka10051Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10051'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 코스피:0, 코스닥:1')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 금액:0, 수량:1')
    base_dt: str | None = Field(None, alias='base_dt', description='기준일자 — YYYYMMDD')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka10051ResponseIndsNetprpsItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_nm: str | None = Field(None, alias='inds_nm', description='업종명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_smbol: str | None = Field(None, alias='pre_smbol', description='대비부호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    sc_netprps: str | None = Field(None, alias='sc_netprps', description='증권순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    insrnc_netprps: str | None = Field(None, alias='insrnc_netprps', description='보험순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    invtrt_netprps: str | None = Field(None, alias='invtrt_netprps', description='투신순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    bank_netprps: str | None = Field(None, alias='bank_netprps', description='은행순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    jnsinkm_netprps: str | None = Field(None, alias='jnsinkm_netprps', description='종신금순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    endw_netprps: str | None = Field(None, alias='endw_netprps', description='기금순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    etc_corp_netprps: str | None = Field(None, alias='etc_corp_netprps', description='기타법인순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    ind_netprps: str | None = Field(None, alias='ind_netprps', description='개인순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    frgnr_netprps: str | None = Field(None, alias='frgnr_netprps', description='외국인순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    native_trmt_frgnr_netprps: str | None = Field(None, alias='native_trmt_frgnr_netprps', description='내국인대우외국인순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    natn_netprps: str | None = Field(None, alias='natn_netprps', description='국가순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    samo_fund_netprps: str | None = Field(None, alias='samo_fund_netprps', description='사모펀드순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')
    orgn_netprps: str | None = Field(None, alias='orgn_netprps', description='기관계순매수 — 단위: 억원 혹은 1000주, 부호가 포함된 숫자')


class Ka10051Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10051'
    inds_netprps: list[Ka10051ResponseIndsNetprpsItem] = Field(default_factory=list, alias='inds_netprps', description='업종별순매수')


class Ka10052Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10052'
    mmcm_cd: str = Field(..., alias='mmcm_cd', description='회원사코드 — 회원사 코드는 ka10102 조회')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:전체, 1:코스피, 2:코스닥, 3:종목')
    qty_tp: str = Field(..., alias='qty_tp', description='수량구분 — 0:전체, 1:1000주, 2:2000주, 3:, 5:, 10:10000주, 30: 30000주, 50: 50000주, 100: 100000주')
    pric_tp: str = Field(..., alias='pric_tp', description='가격구분 — 0:전체, 1:1천원 미만, 8:1천원 이상, 2:1천원 ~ 2천원, 3:2천원 ~ 5천원, 4:5천원 ~ 1만원, 5:1만원 이상')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10052ResponseTrdeOriMontTrdeQtyItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    trde_ori_nm: str | None = Field(None, alias='trde_ori_nm', description='거래원명')
    tp: str | None = Field(None, alias='tp', description='구분')
    mont_trde_qty: str | None = Field(None, alias='mont_trde_qty', description='순간거래량 — 단위: 1주')
    acc_netprps: str | None = Field(None, alias='acc_netprps', description='누적순매수 — 단위: 1주')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10052Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10052'
    trde_ori_mont_trde_qty: list[Ka10052ResponseTrdeOriMontTrdeQtyItem] = Field(default_factory=list, alias='trde_ori_mont_trde_qty', description='거래원순간거래량')


class Ka10053Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10053'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10053ResponseTdyUpperScesnOriItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    sel_scesn_tm: str | None = Field(None, alias='sel_scesn_tm', description='매도이탈시간 — HHmmss')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량 — 단위: 1주')
    sel_upper_scesn_ori: str | None = Field(None, alias='sel_upper_scesn_ori', description='매도상위이탈원')
    buy_scesn_tm: str | None = Field(None, alias='buy_scesn_tm', description='매수이탈시간 — HHmmss')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량 — 단위: 1주')
    buy_upper_scesn_ori: str | None = Field(None, alias='buy_upper_scesn_ori', description='매수상위이탈원')
    qry_dt: str | None = Field(None, alias='qry_dt', description='조회일자')
    qry_tm: str | None = Field(None, alias='qry_tm', description='조회시간')


class Ka10053Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10053'
    tdy_upper_scesn_ori: list[Ka10053ResponseTdyUpperScesnOriItem] = Field(default_factory=list, alias='tdy_upper_scesn_ori', description='당일상위이탈원')


class Ka10054Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10054'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001: 코스피, 101:코스닥')
    bf_mkrt_tp: str = Field(..., alias='bf_mkrt_tp', description='장전구분 — 0:전체, 1:정규시장,2:시간외단일가')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)\n 공백입력시 시장구분으로 설정한 전체종목조회')
    motn_tp: str = Field(..., alias='motn_tp', description='발동구분 — 0:전체, 1:정적VI, 2:동적VI, 3:동적VI + 정적VI')
    skip_stk: str = Field(..., alias='skip_stk', description='제외종목 — 전종목포함 조회시 9개 0으로 설정(000000000),전종목제외 조회시 9개 1으로 설정(111111111),9개 종목조회여부를 조회포함(0), 조회제외(1)로 설정하며 종목순서는 우선주,관리종목,투자경고/위험,투자주의,환기종목,단기과열종목,증거금100%,ETF,ETN가 됨.우선주만 조회시"011111111"", 관리종목만 조회시 ""101111111"" 설정"')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0:사용안함, 1:사용')
    min_trde_qty: str = Field(..., alias='min_trde_qty', description='최소거래량 — 0 주 이상, 거래량구분이 1일때만 입력(공백허용)')
    max_trde_qty: str = Field(..., alias='max_trde_qty', description='최대거래량 — 100000000 주 이하, 거래량구분이 1일때만 입력(공백허용)')
    trde_prica_tp: str = Field(..., alias='trde_prica_tp', description='거래대금구분 — 0:사용안함, 1:사용')
    min_trde_prica: str = Field(..., alias='min_trde_prica', description='최소거래대금 — 0 백만원 이상, 거래대금구분 1일때만 입력(공백허용)')
    max_trde_prica: str = Field(..., alias='max_trde_prica', description='최대거래대금 — 100000000 백만원 이하, 거래대금구분 1일때만 입력(공백허용)')
    motn_drc: str = Field(..., alias='motn_drc', description='발동방향 — 0:전체, 1:상승, 2:하락')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10054ResponseMotnStkItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    motn_pric: str | None = Field(None, alias='motn_pric', description='발동가격 — 단위: 원')
    dynm_dispty_rt: str | None = Field(None, alias='dynm_dispty_rt', description='동적괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_cntr_proc_time: str | None = Field(None, alias='trde_cntr_proc_time', description='매매체결처리시각 — HHmmss')
    virelis_time: str | None = Field(None, alias='virelis_time', description='VI해제시각 — HHmmss')
    viaplc_tp: str | None = Field(None, alias='viaplc_tp', description='VI적용구분')
    dynm_stdpc: str | None = Field(None, alias='dynm_stdpc', description='동적기준가격 — 단위: 원')
    static_stdpc: str | None = Field(None, alias='static_stdpc', description='정적기준가격 — 단위: 원')
    static_dispty_rt: str | None = Field(None, alias='static_dispty_rt', description='정적괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    open_pric_pre_flu_rt: str | None = Field(None, alias='open_pric_pre_flu_rt', description='시가대비등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    vimotn_cnt: str | None = Field(None, alias='vimotn_cnt', description='VI발동횟수')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분')


class Ka10054Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10054'
    motn_stk: list[Ka10054ResponseMotnStkItem] = Field(default_factory=list, alias='motn_stk', description='발동종목')


class Ka10055Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10055'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    tdy_pred: str = Field(..., alias='tdy_pred', description='당일전일 — 1:당일, 2:전일')


class Ka10055ResponseTdyPredCntrQtyItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')


class Ka10055Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10055'
    tdy_pred_cntr_qty: list[Ka10055ResponseTdyPredCntrQtyItem] = Field(default_factory=list, alias='tdy_pred_cntr_qty', description='당일전일체결량')


class Ka10058Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10058'
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 순매도:1, 순매수:2')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')
    invsr_tp: str = Field(..., alias='invsr_tp', description='투자자구분 — 8000:개인, 9000:외국인, 1000:금융투자, 3000:투신, 3100:사모펀드, 5000:기타금융, 4000:은행, 2000:보험, 6000:연기금, 7000:국가, 7100:기타법인, 9999:기관계')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10058ResponseInvsrDalyTrdeStkItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    netslmt_qty: str | None = Field(None, alias='netslmt_qty', description='순매도수량 — 단위: 1주, 부호가 포함된 숫자')
    netslmt_amt: str | None = Field(None, alias='netslmt_amt', description='순매도금액 — 단위: 원, 부호가 포함된 숫자')
    prsm_avg_pric: str | None = Field(None, alias='prsm_avg_pric', description='추정평균가 — 단위: 원')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    avg_pric_pre: str | None = Field(None, alias='avg_pric_pre', description='평균가대비 — 단위: 원, 부호가 포함된 숫자')
    pre_rt: str | None = Field(None, alias='pre_rt', description='대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    dt_trde_qty: str | None = Field(None, alias='dt_trde_qty', description='기간거래량 — 단위: 1주')


class Ka10058Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10058'
    invsr_daly_trde_stk: list[Ka10058ResponseInvsrDalyTrdeStkItem] = Field(default_factory=list, alias='invsr_daly_trde_stk', description='투자자별일별매매종목')


class Ka10059Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10059'
    dt: str = Field(..., alias='dt', description='일자 — YYYYMMDD')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:순매수, 1:매수, 2:매도')
    unit_tp: str = Field(..., alias='unit_tp', description='단위구분 — 1000:천주, 1:단주')


class Ka10059ResponseStkInvsrOrgnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 우측 2자리 소수점자리수')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')
    ind_invsr: str | None = Field(None, alias='ind_invsr', description='개인투자자 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    frgnr_invsr: str | None = Field(None, alias='frgnr_invsr', description='외국인투자자 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    orgn: str | None = Field(None, alias='orgn', description='기관계 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    fnnc_invt: str | None = Field(None, alias='fnnc_invt', description='금융투자 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    insrnc: str | None = Field(None, alias='insrnc', description='보험 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    invtrt: str | None = Field(None, alias='invtrt', description='투신 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    etc_fnnc: str | None = Field(None, alias='etc_fnnc', description='기타금융 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    bank: str | None = Field(None, alias='bank', description='은행 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    penfnd_etc: str | None = Field(None, alias='penfnd_etc', description='연기금등 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    samo_fund: str | None = Field(None, alias='samo_fund', description='사모펀드 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    natn: str | None = Field(None, alias='natn', description='국가')
    etc_corp: str | None = Field(None, alias='etc_corp', description='기타법인 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    natfor: str | None = Field(None, alias='natfor', description='내외국인 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')


class Ka10059Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10059'
    stk_invsr_orgn: list[Ka10059ResponseStkInvsrOrgnItem] = Field(default_factory=list, alias='stk_invsr_orgn', description='종목별투자자기관별')


class Ka10060Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10060'
    dt: str = Field(..., alias='dt', description='일자 — YYYYMMDD')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:순매수, 1:매수, 2:매도')
    unit_tp: str = Field(..., alias='unit_tp', description='단위구분 — 1000:천주, 1:단주')


class Ka10060ResponseStkInvsrOrgnChartItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')
    ind_invsr: str | None = Field(None, alias='ind_invsr', description='개인투자자 — 단위: 백만원')
    frgnr_invsr: str | None = Field(None, alias='frgnr_invsr', description='외국인투자자 — 단위: 백만원')
    orgn: str | None = Field(None, alias='orgn', description='기관계 — 단위: 백만원')
    fnnc_invt: str | None = Field(None, alias='fnnc_invt', description='금융투자 — 단위: 백만원')
    insrnc: str | None = Field(None, alias='insrnc', description='보험 — 단위: 백만원')
    invtrt: str | None = Field(None, alias='invtrt', description='투신 — 단위: 백만원')
    etc_fnnc: str | None = Field(None, alias='etc_fnnc', description='기타금융 — 단위: 백만원')
    bank: str | None = Field(None, alias='bank', description='은행 — 단위: 백만원')
    penfnd_etc: str | None = Field(None, alias='penfnd_etc', description='연기금등 — 단위: 백만원')
    samo_fund: str | None = Field(None, alias='samo_fund', description='사모펀드 — 단위: 백만원')
    natn: str | None = Field(None, alias='natn', description='국가 — 단위: 백만원')
    etc_corp: str | None = Field(None, alias='etc_corp', description='기타법인 — 단위: 백만원')
    natfor: str | None = Field(None, alias='natfor', description='내외국인 — 단위: 백만원')


class Ka10060Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10060'
    stk_invsr_orgn_chart: list[Ka10060ResponseStkInvsrOrgnChartItem] = Field(default_factory=list, alias='stk_invsr_orgn_chart', description='종목별투자자기관별차트')


class Ka10061Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10061'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:순매수')
    unit_tp: str = Field(..., alias='unit_tp', description='단위구분 — 1000:천주, 1:단주')


class Ka10061ResponseStkInvsrOrgnTotItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    ind_invsr: str | None = Field(None, alias='ind_invsr', description='개인투자자 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    frgnr_invsr: str | None = Field(None, alias='frgnr_invsr', description='외국인투자자 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    orgn: str | None = Field(None, alias='orgn', description='기관계 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    fnnc_invt: str | None = Field(None, alias='fnnc_invt', description='금융투자 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    insrnc: str | None = Field(None, alias='insrnc', description='보험 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    invtrt: str | None = Field(None, alias='invtrt', description='투신 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    etc_fnnc: str | None = Field(None, alias='etc_fnnc', description='기타금융 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    bank: str | None = Field(None, alias='bank', description='은행 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    penfnd_etc: str | None = Field(None, alias='penfnd_etc', description='연기금등 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    samo_fund: str | None = Field(None, alias='samo_fund', description='사모펀드 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    natn: str | None = Field(None, alias='natn', description='국가')
    etc_corp: str | None = Field(None, alias='etc_corp', description='기타법인 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')
    natfor: str | None = Field(None, alias='natfor', description='내외국인 — 금액 단위: 백만원, 수량 단위: 1000주 혹은 1주(unit_tp값으로 설정)')


class Ka10061Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10061'
    stk_invsr_orgn_tot: list[Ka10061ResponseStkInvsrOrgnTotItem] = Field(default_factory=list, alias='stk_invsr_orgn_tot', description='종목별투자자기관별합계')


class Ka10062Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10062'
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001: 코스피, 101:코스닥')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매수, 2:순매도')
    sort_cnd: str = Field(..., alias='sort_cnd', description='정렬조건 — 1:수량, 2:금액')
    unit_tp: str = Field(..., alias='unit_tp', description='단위구분 — 1:단주, 1000:천주')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10062ResponseEqlNettrdeRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    orgn_nettrde_qty: str | None = Field(None, alias='orgn_nettrde_qty', description='기관순매매수량 — 단위: 1주 혹은 1000주(unit_tp파라미터로 설정), 부호가 포함된 숫자')
    orgn_nettrde_amt: str | None = Field(None, alias='orgn_nettrde_amt', description='기관순매매금액 — 단위: 백만원, 부호가 포함된 숫자')
    orgn_nettrde_avg_pric: str | None = Field(None, alias='orgn_nettrde_avg_pric', description='기관순매매평균가 — 단위: 백만원')
    for_nettrde_qty: str | None = Field(None, alias='for_nettrde_qty', description='외인순매매수량 — 단위: 1주 혹은 1000주(unit_tp파라미터로 설정), 부호가 포함된 숫자')
    for_nettrde_amt: str | None = Field(None, alias='for_nettrde_amt', description='외인순매매금액 — 단위: 백만원, 부호가 포함된 숫자')
    for_nettrde_avg_pric: str | None = Field(None, alias='for_nettrde_avg_pric', description='외인순매매평균가 — 단위: 백만원')
    nettrde_qty: str | None = Field(None, alias='nettrde_qty', description='순매매수량 — 단위: 1주 혹은 1000주(unit_tp파라미터로 설정), 부호가 포함된 숫자')
    nettrde_amt: str | None = Field(None, alias='nettrde_amt', description='순매매금액 — 단위: 백만원, 부호가 포함된 숫자')


class Ka10062Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10062'
    eql_nettrde_rank: list[Ka10062ResponseEqlNettrdeRankItem] = Field(default_factory=list, alias='eql_nettrde_rank', description='동일순매매순위')


class Ka10063Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10063'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1: 금액&수량')
    invsr: str = Field(..., alias='invsr', description='투자자별 — 6:외국인, 7:기관계, 1:투신, 0:보험, 2:은행, 3:연기금, 4:국가, 5:기타법인')
    frgn_all: str = Field(..., alias='frgn_all', description='외국계전체 — 1:체크, 0:미체크')
    smtm_netprps_tp: str = Field(..., alias='smtm_netprps_tp', description='동시순매수구분 — 1:체크, 0:미체크')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10063ResponseOpmrInvsrTrdeItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    netprps_amt: str | None = Field(None, alias='netprps_amt', description='순매수금액 — 단위: 백만원')
    prev_netprps_amt: str | None = Field(None, alias='prev_netprps_amt', description='이전순매수금액 — 단위: 백만원')
    buy_amt: str | None = Field(None, alias='buy_amt', description='매수금액 — 단위: 백만원')
    netprps_amt_irds: str | None = Field(None, alias='netprps_amt_irds', description='순매수금액증감 — 단위: 백만원')
    buy_amt_irds: str | None = Field(None, alias='buy_amt_irds', description='매수금액증감 — 단위: 백만원')
    sell_amt: str | None = Field(None, alias='sell_amt', description='매도금액 — 단위: 백만원')
    sell_amt_irds: str | None = Field(None, alias='sell_amt_irds', description='매도금액증감 — 단위: 백만원')
    netprps_qty: str | None = Field(None, alias='netprps_qty', description='순매수수량 — 단위: 1주')
    prev_pot_netprps_qty: str | None = Field(None, alias='prev_pot_netprps_qty', description='이전시점순매수수량 — 단위: 1주')
    netprps_irds: str | None = Field(None, alias='netprps_irds', description='순매수증감 — 단위: 1주')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량 — 단위: 1주')
    buy_qty_irds: str | None = Field(None, alias='buy_qty_irds', description='매수수량증감 — 단위: 1주')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량 — 단위: 1주')
    sell_qty_irds: str | None = Field(None, alias='sell_qty_irds', description='매도수량증감 — 단위: 1주')


class Ka10063Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10063'
    opmr_invsr_trde: list[Ka10063ResponseOpmrInvsrTrdeItem] = Field(default_factory=list, alias='opmr_invsr_trde', description='장중투자자별매매')


class Ka10064Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10064'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:순매수, 1:매수, 2:매도')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')


class Ka10064ResponseOpmrInvsrTrdeChartItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    frgnr_invsr: str | None = Field(None, alias='frgnr_invsr', description='외국인투자자 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    orgn: str | None = Field(None, alias='orgn', description='기관계 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    invtrt: str | None = Field(None, alias='invtrt', description='투신 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    insrnc: str | None = Field(None, alias='insrnc', description='보험 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    bank: str | None = Field(None, alias='bank', description='은행 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    penfnd_etc: str | None = Field(None, alias='penfnd_etc', description='연기금등 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    etc_corp: str | None = Field(None, alias='etc_corp', description='기타법인 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')
    natn: str | None = Field(None, alias='natn', description='국가 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정)')


class Ka10064Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10064'
    opmr_invsr_trde_chart: list[Ka10064ResponseOpmrInvsrTrdeChartItem] = Field(default_factory=list, alias='opmr_invsr_trde_chart', description='장중투자자별매매차트')


class Ka10065Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10065'
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매수, 2:순매도')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    orgn_tp: str = Field(..., alias='orgn_tp', description='기관구분 — 9000:외국인, 9100:외국계, 1000:금융투자, 3000:투신, 5000:기타금융, 4000:은행, 2000:보험, 6000:연기금, 7000:국가, 7100:기타법인, 9999:기관계')
    amt_qty_tp: str | None = Field(None, alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')


class Ka10065ResponseOpmrInvsrTrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    sel_qty: str | None = Field(None, alias='sel_qty', description='매도금액/매도량 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정), 부호가 있는 숫자')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수금액/매수량 — 단위: 1주 혹은 백만원(amt_qty_tp파라미터로 설정), 부호가 있는 숫자')
    netslmt: str | None = Field(None, alias='netslmt', description='순매수/순매도 — 단위: 1주 혹은 백만원(trde_tp파라미터로 설정), 부호가 있는 숫자')


class Ka10065Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10065'
    opmr_invsr_trde_upper: list[Ka10065ResponseOpmrInvsrTrdeUpperItem] = Field(default_factory=list, alias='opmr_invsr_trde_upper', description='장중투자자별매매상위')


class Ka10066Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10066'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:순매수, 1:매수, 2:매도')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka10066ResponseOpafInvsrTrdeItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    ind_invsr: str | None = Field(None, alias='ind_invsr', description='개인투자자 — 단위: 백만원, 1주')
    frgnr_invsr: str | None = Field(None, alias='frgnr_invsr', description='외국인투자자 — 단위: 백만원, 1주')
    orgn: str | None = Field(None, alias='orgn', description='기관계 — 단위: 백만원, 1주')
    fnnc_invt: str | None = Field(None, alias='fnnc_invt', description='금융투자 — 단위: 백만원, 1주')
    insrnc: str | None = Field(None, alias='insrnc', description='보험 — 단위: 백만원, 1주')
    invtrt: str | None = Field(None, alias='invtrt', description='투신 — 단위: 백만원, 1주')
    etc_fnnc: str | None = Field(None, alias='etc_fnnc', description='기타금융 — 단위: 백만원, 1주')
    bank: str | None = Field(None, alias='bank', description='은행 — 단위: 백만원, 1주')
    penfnd_etc: str | None = Field(None, alias='penfnd_etc', description='연기금등 — 단위: 백만원, 1주')
    samo_fund: str | None = Field(None, alias='samo_fund', description='사모펀드 — 단위: 백만원, 1주')
    natn: str | None = Field(None, alias='natn', description='국가 — 단위: 백만원, 1주')
    etc_corp: str | None = Field(None, alias='etc_corp', description='기타법인 — 단위: 백만원, 1주')


class Ka10066Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10066'
    opaf_invsr_trde: list[Ka10066ResponseOpafInvsrTrdeItem] = Field(default_factory=list, alias='opaf_invsr_trde', description='장중투자자별매매차트')


class Ka10068Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10068'
    strt_dt: str | None = Field(None, alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD')
    all_tp: str = Field(..., alias='all_tp', description='전체구분 — 1: 전체표시')


class Ka10068ResponseDbrtTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    dbrt_trde_cntrcnt: str | None = Field(None, alias='dbrt_trde_cntrcnt', description='대차거래체결주수 — 단위: 1주')
    dbrt_trde_rpy: str | None = Field(None, alias='dbrt_trde_rpy', description='대차거래상환주수 — 단위: 1주')
    dbrt_trde_irds: str | None = Field(None, alias='dbrt_trde_irds', description='대차거래증감 — 단위: 1주')
    rmnd: str | None = Field(None, alias='rmnd', description='잔고주수 — 단위: 1주')
    remn_amt: str | None = Field(None, alias='remn_amt', description='잔고금액 — 단위: 백만원')


class Ka10068Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10068'
    dbrt_trde_trnsn: list[Ka10068ResponseDbrtTrdeTrnsnItem] = Field(default_factory=list, alias='dbrt_trde_trnsn', description='대차거래추이')


class Ka10069Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10069'
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')


class Ka10069ResponseDbrtTrdeUpper10stkItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    dbrt_trde_cntrcnt: str | None = Field(None, alias='dbrt_trde_cntrcnt', description='대차거래체결주수 — 단위: 1주')
    dbrt_trde_rpy: str | None = Field(None, alias='dbrt_trde_rpy', description='대차거래상환주수 — 단위: 1주')
    rmnd: str | None = Field(None, alias='rmnd', description='잔고주수 — 단위: 1주')
    remn_amt: str | None = Field(None, alias='remn_amt', description='잔고금액 — 단위: 백만원')


class Ka10069Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10069'
    dbrt_trde_cntrcnt_sum: str | None = Field(None, alias='dbrt_trde_cntrcnt_sum', description='대차거래체결주수합 — 단위: 1주')
    dbrt_trde_rpy_sum: str | None = Field(None, alias='dbrt_trde_rpy_sum', description='대차거래상환주수합 — 단위: 1주')
    rmnd_sum: str | None = Field(None, alias='rmnd_sum', description='잔고주수합 — 단위: 1주')
    remn_amt_sum: str | None = Field(None, alias='remn_amt_sum', description='잔고금액합 — 단위: 백만원')
    dbrt_trde_cntrcnt_rt: str | None = Field(None, alias='dbrt_trde_cntrcnt_rt', description='대차거래체결주수비율 — 소수점 제거 된 100배 값으로 제공\n\n예) "2658"는 26.58%를 의미합니다.')
    dbrt_trde_rpy_rt: str | None = Field(None, alias='dbrt_trde_rpy_rt', description='대차거래상환주수비율 — 소수점 제거 된 100배 값으로 제공\n\n예) "2658"는 26.58%를 의미합니다.')
    rmnd_rt: str | None = Field(None, alias='rmnd_rt', description='잔고주수비율 — 소수점 제거 된 100배 값으로 제공\n\n예) "2658"는 26.58%를 의미합니다.')
    remn_amt_rt: str | None = Field(None, alias='remn_amt_rt', description='잔고금액비율 — 소수점 제거 된 100배 값으로 제공\n\n예) "2658"는 26.58%를 의미합니다.')
    dbrt_trde_upper_10stk: list[Ka10069ResponseDbrtTrdeUpper10stkItem] = Field(default_factory=list, alias='dbrt_trde_upper_10stk', description='대차거래상위10종목')


class Ka10072Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10072'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')


class Ka10072ResponseDtStkDivRlztPlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    buy_uv: str | None = Field(None, alias='buy_uv', description='매입단가 — 단위: 원')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    tdy_sel_pl: str | None = Field(None, alias='tdy_sel_pl', description='당일매도손익 — 단위: 원')
    pl_rt: str | None = Field(None, alias='pl_rt', description='손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')
    wthd_alowa: str | None = Field(None, alias='wthd_alowa', description='인출가능금액 — 단위: 원')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYYMMDD')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')
    stk_cd_1: str | None = Field(None, alias='stk_cd_1', description='종목코드1')
    tdy_sel_pl_1: str | None = Field(None, alias='tdy_sel_pl_1', description='당일매도손익1')


class Ka10072Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10072'
    dt_stk_div_rlzt_pl: list[Ka10072ResponseDtStkDivRlztPlItem] = Field(default_factory=list, alias='dt_stk_div_rlzt_pl', description='일자별종목별실현손익')


class Ka10073Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10073'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')


class Ka10073ResponseDtStkRlztPlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    tdy_htssel_cmsn: str | None = Field(None, alias='tdy_htssel_cmsn', description='당일hts매도수수료 — 단위: 원')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    buy_uv: str | None = Field(None, alias='buy_uv', description='매입단가 — 단위: 원')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    tdy_sel_pl: str | None = Field(None, alias='tdy_sel_pl', description='당일매도손익 — 단위: 원')
    pl_rt: str | None = Field(None, alias='pl_rt', description='손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')
    wthd_alowa: str | None = Field(None, alias='wthd_alowa', description='인출가능금액 — 단위: 원')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYYMMDD')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')


class Ka10073Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10073'
    dt_stk_rlzt_pl: list[Ka10073ResponseDtStkRlztPlItem] = Field(default_factory=list, alias='dt_stk_rlzt_pl', description='일자별종목별실현손익')


class Ka10074Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10074'
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')


class Ka10074ResponseDtRlztPlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    buy_amt: str | None = Field(None, alias='buy_amt', description='매수금액 — 단위: 원')
    sell_amt: str | None = Field(None, alias='sell_amt', description='매도금액 — 단위: 원')
    tdy_sel_pl: str | None = Field(None, alias='tdy_sel_pl', description='당일매도손익 — 단위: 원')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')


class Ka10074Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10074'
    tot_buy_amt: str | None = Field(None, alias='tot_buy_amt', description='총매수금액 — 단위: 원')
    tot_sell_amt: str | None = Field(None, alias='tot_sell_amt', description='총매도금액 — 단위: 원')
    rlzt_pl: str | None = Field(None, alias='rlzt_pl', description='실현손익 — 단위: 원')
    trde_cmsn: str | None = Field(None, alias='trde_cmsn', description='매매수수료 — 단위: 원')
    trde_tax: str | None = Field(None, alias='trde_tax', description='매매세금 — 단위: 원')
    dt_rlzt_pl: list[Ka10074ResponseDtRlztPlItem] = Field(default_factory=list, alias='dt_rlzt_pl', description='일자별실현손익')


class Ka10075Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10075'
    all_stk_tp: str = Field(..., alias='all_stk_tp', description='전체종목구분 — 0:전체, 1:종목')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:전체, 1:매도, 2:매수')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 0 : 통합, 1 : KRX, 2 : NXT')


class Ka10075ResponseOsoItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    acnt_no: str | None = Field(None, alias='acnt_no', description='계좌번호 — 고유 계좌번호 10자리 숫자')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 고유 주문번호 7자리 숫자')
    mang_empno: str | None = Field(None, alias='mang_empno', description='관리사번')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    tsk_tp: str | None = Field(None, alias='tsk_tp', description='업무구분')
    ord_stt: str | None = Field(None, alias='ord_stt', description='주문상태')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_pric: str | None = Field(None, alias='ord_pric', description='주문가격 — 단위: 원')
    oso_qty: str | None = Field(None, alias='oso_qty', description='미체결수량 — 단위: 1주')
    cntr_tot_amt: str | None = Field(None, alias='cntr_tot_amt', description='체결누계금액 — 단위: 원')
    orig_ord_no: str | None = Field(None, alias='orig_ord_no', description="원주문번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문구분')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    tm: str | None = Field(None, alias='tm', description='시간 — 주문 시간, HHmmss')
    cntr_no: str | None = Field(None, alias='cntr_no', description='체결번호')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 현재 첫번째 매도호가')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 현재 첫번째 매수호가')
    unit_cntr_pric: str | None = Field(None, alias='unit_cntr_pric', description='단위체결가 — 단위: 원')
    unit_cntr_qty: str | None = Field(None, alias='unit_cntr_qty', description='단위체결량 — 단위: 1주')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')
    ind_invsr: str | None = Field(None, alias='ind_invsr', description='개인투자자')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — 0 : 통합, 1 : KRX, 2 : NXT')
    stex_tp_txt: str | None = Field(None, alias='stex_tp_txt', description='거래소구분텍스트 — 통합,KRX,NXT')
    sor_yn: str | None = Field(None, alias='sor_yn', description='SOR 여부값 — Y,N')
    stop_pric: str | None = Field(None, alias='stop_pric', description='스톱가 — 스톱지정가주문 스톱가')


class Ka10075Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10075'
    oso: list[Ka10075ResponseOsoItem] = Field(default_factory=list, alias='oso', description='미체결')


class Ka10076Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10076'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 0:전체, 1:종목')
    sell_tp: str = Field(..., alias='sell_tp', description='매도수구분 — 0:전체, 1:매도, 2:매수')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 검색 기준 값으로 입력한 주문번호 보다 과거에 체결된 내역이 조회됩니다.')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 0 : 통합, 1 : KRX, 2 : NXT')


class Ka10076ResponseCntrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 주문번호 7자리')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문구분')
    ord_pric: str | None = Field(None, alias='ord_pric', description='주문가격 — 단위: 원')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    oso_qty: str | None = Field(None, alias='oso_qty', description='미체결수량 — 단위: 1주')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')
    ord_stt: str | None = Field(None, alias='ord_stt', description='주문상태')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    orig_ord_no: str | None = Field(None, alias='orig_ord_no', description="원주문번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    ord_tm: str | None = Field(None, alias='ord_tm', description='주문시간 — HHmmss')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목코드 6자리')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — 0 : 통합, 1 : KRX, 2 : NXT')
    stex_tp_txt: str | None = Field(None, alias='stex_tp_txt', description='거래소구분텍스트 — 통합,KRX,NXT')
    sor_yn: str | None = Field(None, alias='sor_yn', description='SOR 여부값 — Y,N')
    stop_pric: str | None = Field(None, alias='stop_pric', description='스톱가 — 스톱지정가주문 스톱가')


class Ka10076Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10076'
    cntr: list[Ka10076ResponseCntrItem] = Field(default_factory=list, alias='cntr', description='체결')


class Ka10077Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10077'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 종목코드 6자리')


class Ka10077ResponseTdyRlztPlDtlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    buy_uv: str | None = Field(None, alias='buy_uv', description='매입단가 — 단위: 원')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    tdy_sel_pl: str | None = Field(None, alias='tdy_sel_pl', description='당일매도손익 — 단위: 원')
    pl_rt: str | None = Field(None, alias='pl_rt', description='손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')


class Ka10077Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10077'
    tdy_rlzt_pl: str | None = Field(None, alias='tdy_rlzt_pl', description='당일실현손익 — 단위: 원')
    tdy_rlzt_pl_dtl: list[Ka10077ResponseTdyRlztPlDtlItem] = Field(default_factory=list, alias='tdy_rlzt_pl_dtl', description='당일실현손익상세')


class Ka10078Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10078'
    mmcm_cd: str = Field(..., alias='mmcm_cd', description='회원사코드 — 회원사 코드는 ka10102 조회')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')


class Ka10078ResponseSecStkTrdeTrendItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    netprps_qty: str | None = Field(None, alias='netprps_qty', description='순매수수량 — 단위: 1주')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량 — 단위: 1주')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량 — 단위: 1주')


class Ka10078Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10078'
    sec_stk_trde_trend: list[Ka10078ResponseSecStkTrdeTrendItem] = Field(default_factory=list, alias='sec_stk_trde_trend', description='증권사별종목매매동향')


class Ka10079Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10079'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1틱, 3:3틱, 5:5틱, 10:10틱, 30:30틱')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka10079ResponseStkTicChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비 기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka10079Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10079'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    last_tic_cnt: str | None = Field(None, alias='last_tic_cnt', description='마지막틱갯수')
    stk_tic_chart_qry: list[Ka10079ResponseStkTicChartQryItem] = Field(default_factory=list, alias='stk_tic_chart_qry', description='주식틱차트조회')


class Ka10080Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10080'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1분, 3:3분, 5:5분, 10:10분, 15:15분, 30:30분, 45:45분, 60:60분')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')
    base_dt: str | None = Field(None, alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka10080ResponseStkMinPoleChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가(종가) — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비 기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka10080Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10080'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_min_pole_chart_qry: list[Ka10080ResponseStkMinPoleChartQryItem] = Field(default_factory=list, alias='stk_min_pole_chart_qry', description='주식분봉차트조회')


class Ka10081Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10081'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1 / 수정주가 적용을 원하시는 경우, 권리발생일 이후 일자를 base_dt에 넣어 조회 또는 연속조회해주시기 바랍니다. 예를 들어 삼성전자 2018년 05월 04일 (액면분할 권리발생일)을 base_dt에 넣고 수정주가적용(1)로 조회하면 2018년 05월 04일 이전 데이터는 수정주가 적용된 3만원대 가격이 나옵니다. 연속조회도 동일합니다. 권리 발생일 이전인 2018년 05월 03일 이전 일자로 base_dt 조회 시 수정주가 적용되지 않아 200만원 이상 가격대가 나옵니다. 수정주가 적용을 원하는 과거 차트 데이터 조회를 위해서는 해당 권리발생일 이후로 base_dt를 세팅하고, 수정주가 적용(1)로 세팅하고 조회 및 연속조회하여야합니다.')


class Ka10081ResponseStkDtPoleChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    trde_tern_rt: str | None = Field(None, alias='trde_tern_rt', description='거래회전율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10081Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10081'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_dt_pole_chart_qry: list[Ka10081ResponseStkDtPoleChartQryItem] = Field(default_factory=list, alias='stk_dt_pole_chart_qry', description='주식일봉차트조회')


class Ka10082Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10082'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka10082ResponseStkStkPoleChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    trde_tern_rt: str | None = Field(None, alias='trde_tern_rt', description='거래회전율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10082Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10082'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_stk_pole_chart_qry: list[Ka10082ResponseStkStkPoleChartQryItem] = Field(default_factory=list, alias='stk_stk_pole_chart_qry', description='주식주봉차트조회')


class Ka10083Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10083'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka10083ResponseStkMthPoleChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    trde_tern_rt: str | None = Field(None, alias='trde_tern_rt', description='거래회전율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10083Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10083'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_mth_pole_chart_qry: list[Ka10083ResponseStkMthPoleChartQryItem] = Field(default_factory=list, alias='stk_mth_pole_chart_qry', description='주식월봉차트조회')


class Ka10084Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10084'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    tdy_pred: str = Field(..., alias='tdy_pred', description='당일전일 — 당일 : 1, 전일 : 2')
    tic_min: str = Field(..., alias='tic_min', description='틱분 — 0:틱, 1:분')
    tm: str | None = Field(None, alias='tm', description="시간 — 조회시간 4자리, 오전 9시일 경우 0900, 오후 2시 30분일 경우 1430, 빈값('') 입력 시 현재시간으로 자동 설정")


class Ka10084ResponseTdyPredCntrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pre_rt: str | None = Field(None, alias='pre_rt', description='대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pri_sel_bid_unit: str | None = Field(None, alias='pri_sel_bid_unit', description='우선매도호가단위 — 단위: 원, 부호가 포함된 숫자')
    pri_buy_bid_unit: str | None = Field(None, alias='pri_buy_bid_unit', description='우선매수호가단위 — 단위: 원, 부호가 포함된 숫자')
    cntr_trde_qty: str | None = Field(None, alias='cntr_trde_qty', description='체결거래량 — 단위: 1주, 부호가 포함된 숫자')
    sign: str | None = Field(None, alias='sign', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — KRX , NXT , 통합')


class Ka10084Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10084'
    tdy_pred_cntr: list[Ka10084ResponseTdyPredCntrItem] = Field(default_factory=list, alias='tdy_pred_cntr', description='당일전일체결')


class Ka10085Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10085'
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 0 : 통합, 1 : KRX, 2 : NXT')


class Ka10085ResponseAcntPrftRtItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    pur_pric: str | None = Field(None, alias='pur_pric', description='매입가 — 단위: 원')
    pur_amt: str | None = Field(None, alias='pur_amt', description='매입금액 — 단위: 원')
    rmnd_qty: str | None = Field(None, alias='rmnd_qty', description='보유수량 — 단위: 1주')
    tdy_sel_pl: str | None = Field(None, alias='tdy_sel_pl', description='당일매도손익 — 단위: 원')
    tdy_trde_cmsn: str | None = Field(None, alias='tdy_trde_cmsn', description='당일매매수수료 — 단위: 원')
    tdy_trde_tax: str | None = Field(None, alias='tdy_trde_tax', description='당일매매세금 — 단위: 원')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')
    loan_dt: str | None = Field(None, alias='loan_dt', description="대출일 — YYYYMMDD, 대출일이 없는 경우 '00000000'로 출력")
    setl_remn: str | None = Field(None, alias='setl_remn', description='결제잔고 — 단위: 원')
    clrn_alow_qty: str | None = Field(None, alias='clrn_alow_qty', description='청산가능수량 — 단위: 1주')
    crd_amt: str | None = Field(None, alias='crd_amt', description='신용금액 — 단위: 원')
    crd_int: str | None = Field(None, alias='crd_int', description='신용이자 — 단위: 원')
    expr_dt: str | None = Field(None, alias='expr_dt', description="만기일 — YYYYMMDD, 만기일이 없는 경우 '00000000'로 출력")


class Ka10085Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10085'
    acnt_prft_rt: list[Ka10085ResponseAcntPrftRtItem] = Field(default_factory=list, alias='acnt_prft_rt', description='계좌수익률')


class Ka10086Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10086'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    qry_dt: str = Field(..., alias='qry_dt', description='조회일자 — YYYYMMDD')
    indc_tp: str = Field(..., alias='indc_tp', description='표시구분 — 0:수량, 1:금액(백만원)')


class Ka10086ResponseDalyStkpcItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pred_rt: str | None = Field(None, alias='pred_rt', description='전일비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    amt_mn: str | None = Field(None, alias='amt_mn', description='금액(백만) — 단위: 백만원')
    crd_rt: str | None = Field(None, alias='crd_rt', description='신용비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    ind: str | None = Field(None, alias='ind', description='개인 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    orgn: str | None = Field(None, alias='orgn', description='기관 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    for_qty: str | None = Field(None, alias='for_qty', description='외인수량 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    frgn: str | None = Field(None, alias='frgn', description='외국계 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    prm: str | None = Field(None, alias='prm', description='프로그램 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    for_rt: str | None = Field(None, alias='for_rt', description='외인비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    for_poss: str | None = Field(None, alias='for_poss', description='외인보유 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    for_wght: str | None = Field(None, alias='for_wght', description='외인비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    for_netprps: str | None = Field(None, alias='for_netprps', description='외인순매수 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    orgn_netprps: str | None = Field(None, alias='orgn_netprps', description='기관순매수 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    ind_netprps: str | None = Field(None, alias='ind_netprps', description='개인순매수 — 단위: 백만원, 1주, 부호가 포함된 숫자')
    crd_remn_rt: str | None = Field(None, alias='crd_remn_rt', description='신용잔고율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10086Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10086'
    daly_stkpc: list[Ka10086ResponseDalyStkpcItem] = Field(default_factory=list, alias='daly_stkpc', description='일별주가')


class Ka10087Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10087'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka10087Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    bid_req_base_tm: str | None = Field(None, alias='bid_req_base_tm', description='호가잔량기준시간 — HHmmss')
    ovt_sigpric_sel_bid_jub_pre_5: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_5', description='시간외단일가_매도호가직전대비5 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_4: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_4', description='시간외단일가_매도호가직전대비4 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_3: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_3', description='시간외단일가_매도호가직전대비3 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_2: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_2', description='시간외단일가_매도호가직전대비2 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_1: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_1', description='시간외단일가_매도호가직전대비1 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_qty_5: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_5', description='시간외단일가_매도호가수량5 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_4: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_4', description='시간외단일가_매도호가수량4 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_3: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_3', description='시간외단일가_매도호가수량3 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_2: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_2', description='시간외단일가_매도호가수량2 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_1: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_1', description='시간외단일가_매도호가수량1 — 단위: 1주')
    ovt_sigpric_sel_bid_5: str | None = Field(None, alias='ovt_sigpric_sel_bid_5', description='시간외단일가_매도호가5 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_4: str | None = Field(None, alias='ovt_sigpric_sel_bid_4', description='시간외단일가_매도호가4 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_3: str | None = Field(None, alias='ovt_sigpric_sel_bid_3', description='시간외단일가_매도호가3 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_2: str | None = Field(None, alias='ovt_sigpric_sel_bid_2', description='시간외단일가_매도호가2 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_1: str | None = Field(None, alias='ovt_sigpric_sel_bid_1', description='시간외단일가_매도호가1 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_1: str | None = Field(None, alias='ovt_sigpric_buy_bid_1', description='시간외단일가_매수호가1 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_2: str | None = Field(None, alias='ovt_sigpric_buy_bid_2', description='시간외단일가_매수호가2 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_3: str | None = Field(None, alias='ovt_sigpric_buy_bid_3', description='시간외단일가_매수호가3 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_4: str | None = Field(None, alias='ovt_sigpric_buy_bid_4', description='시간외단일가_매수호가4 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_5: str | None = Field(None, alias='ovt_sigpric_buy_bid_5', description='시간외단일가_매수호가5 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_qty_1: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_1', description='시간외단일가_매수호가수량1 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_2: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_2', description='시간외단일가_매수호가수량2 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_3: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_3', description='시간외단일가_매수호가수량3 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_4: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_4', description='시간외단일가_매수호가수량4 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_5: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_5', description='시간외단일가_매수호가수량5 — 단위: 1주')
    ovt_sigpric_buy_bid_jub_pre_1: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_1', description='시간외단일가_매수호가직전대비1 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_2: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_2', description='시간외단일가_매수호가직전대비2 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_3: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_3', description='시간외단일가_매수호가직전대비3 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_4: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_4', description='시간외단일가_매수호가직전대비4 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_5: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_5', description='시간외단일가_매수호가직전대비5 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_tot_req: str | None = Field(None, alias='ovt_sigpric_sel_bid_tot_req', description='시간외단일가_매도호가총잔량 — 단위: 1주')
    ovt_sigpric_buy_bid_tot_req: str | None = Field(None, alias='ovt_sigpric_buy_bid_tot_req', description='시간외단일가_매수호가총잔량 — 단위: 1주')
    sel_bid_tot_req_jub_pre: str | None = Field(None, alias='sel_bid_tot_req_jub_pre', description='매도호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_bid_tot_req: str | None = Field(None, alias='sel_bid_tot_req', description='매도호가총잔량 — 단위: 1주')
    buy_bid_tot_req: str | None = Field(None, alias='buy_bid_tot_req', description='매수호가총잔량 — 단위: 1주')
    buy_bid_tot_req_jub_pre: str | None = Field(None, alias='buy_bid_tot_req_jub_pre', description='매수호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_bid_tot_req_jub_pre: str | None = Field(None, alias='ovt_sel_bid_tot_req_jub_pre', description='시간외매도호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_bid_tot_req: str | None = Field(None, alias='ovt_sel_bid_tot_req', description='시간외매도호가총잔량 — 단위: 1주')
    ovt_buy_bid_tot_req: str | None = Field(None, alias='ovt_buy_bid_tot_req', description='시간외매수호가총잔량 — 단위: 1주')
    ovt_buy_bid_tot_req_jub_pre: str | None = Field(None, alias='ovt_buy_bid_tot_req_jub_pre', description='시간외매수호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_cur_prc: str | None = Field(None, alias='ovt_sigpric_cur_prc', description='시간외단일가_현재가 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_pred_pre_sig: str | None = Field(None, alias='ovt_sigpric_pred_pre_sig', description='시간외단일가_전일대비기호')
    ovt_sigpric_pred_pre: str | None = Field(None, alias='ovt_sigpric_pred_pre', description='시간외단일가_전일대비 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_flu_rt: str | None = Field(None, alias='ovt_sigpric_flu_rt', description='시간외단일가_등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    ovt_sigpric_acc_trde_qty: str | None = Field(None, alias='ovt_sigpric_acc_trde_qty', description='시간외단일가_누적거래량 — 단위: 1주')


class Ka10088Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10088'
    ord_no: str = Field(..., alias='ord_no', description='주문번호 — 주문번호 7자리')


class Ka10088ResponseOsopItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 주문번호 7자리')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_pric: str | None = Field(None, alias='ord_pric', description='주문가격 — 단위: 원')
    osop_qty: str | None = Field(None, alias='osop_qty', description='미체결수량 — 단위: 1주')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문구분')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    sell_tp: str | None = Field(None, alias='sell_tp', description='매도/수 구분')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    ord_stt: str | None = Field(None, alias='ord_stt', description='주문상태')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — 0 : 통합, 1 : KRX, 2 : NXT')
    stex_tp_txt: str | None = Field(None, alias='stex_tp_txt', description='거래소구분텍스트 — 통합,KRX,NXT')


class Ka10088Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10088'
    osop: list[Ka10088ResponseOsopItem] = Field(default_factory=list, alias='osop', description='미체결분할주문리스트')


class Ka10094Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10094'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka10094ResponseStkYrPoleChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')


class Ka10094Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10094'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_yr_pole_chart_qry: list[Ka10094ResponseStkYrPoleChartQryItem] = Field(default_factory=list, alias='stk_yr_pole_chart_qry', description='주식년봉차트조회')


class Ka10095Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10095'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)\n여러개의 종목코드 입력시 | 로 구분')


class Ka10095ResponseAtnStkInfrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주, 부호가 포함된 숫자')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pred_trde_qty_pre: str | None = Field(None, alias='pred_trde_qty_pre', description='전일거래량대비')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    sel_1th_bid: str | None = Field(None, alias='sel_1th_bid', description='매도1차호가 — 단위: 원, 부호가 포함된 숫자')
    sel_2th_bid: str | None = Field(None, alias='sel_2th_bid', description='매도2차호가 — 단위: 원, 부호가 포함된 숫자')
    sel_3th_bid: str | None = Field(None, alias='sel_3th_bid', description='매도3차호가 — 단위: 원, 부호가 포함된 숫자')
    sel_4th_bid: str | None = Field(None, alias='sel_4th_bid', description='매도4차호가 — 단위: 원, 부호가 포함된 숫자')
    sel_5th_bid: str | None = Field(None, alias='sel_5th_bid', description='매도5차호가 — 단위: 원, 부호가 포함된 숫자')
    buy_1th_bid: str | None = Field(None, alias='buy_1th_bid', description='매수1차호가 — 단위: 원, 부호가 포함된 숫자')
    buy_2th_bid: str | None = Field(None, alias='buy_2th_bid', description='매수2차호가 — 단위: 원, 부호가 포함된 숫자')
    buy_3th_bid: str | None = Field(None, alias='buy_3th_bid', description='매수3차호가 — 단위: 원, 부호가 포함된 숫자')
    buy_4th_bid: str | None = Field(None, alias='buy_4th_bid', description='매수4차호가 — 단위: 원, 부호가 포함된 숫자')
    buy_5th_bid: str | None = Field(None, alias='buy_5th_bid', description='매수5차호가 — 단위: 원, 부호가 포함된 숫자')
    upl_pric: str | None = Field(None, alias='upl_pric', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    lst_pric: str | None = Field(None, alias='lst_pric', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상체결가 — 단위: 원, 부호가 포함된 숫자')
    exp_cntr_qty: str | None = Field(None, alias='exp_cntr_qty', description='예상체결량 — 단위: 1주')
    cap: str | None = Field(None, alias='cap', description='자본금 — 단위: 억원')
    fav: str | None = Field(None, alias='fav', description='액면가 — 단위: 원')
    mac: str | None = Field(None, alias='mac', description='시가총액 — 단위: 억원')
    stkcnt: str | None = Field(None, alias='stkcnt', description='주식수 — 단위: 1주')
    bid_tm: str | None = Field(None, alias='bid_tm', description='호가시간 — HHmmss')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    pri_sel_req: str | None = Field(None, alias='pri_sel_req', description='우선매도잔량 — 단위: 1주')
    pri_buy_req: str | None = Field(None, alias='pri_buy_req', description='우선매수잔량 — 단위: 1주')
    pri_sel_cnt: str | None = Field(None, alias='pri_sel_cnt', description='우선매도건수')
    pri_buy_cnt: str | None = Field(None, alias='pri_buy_cnt', description='우선매수건수')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')
    tot_sel_cnt: str | None = Field(None, alias='tot_sel_cnt', description='총매도건수')
    tot_buy_cnt: str | None = Field(None, alias='tot_buy_cnt', description='총매수건수')
    prty: str | None = Field(None, alias='prty', description='패리티 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    gear: str | None = Field(None, alias='gear', description='기어링 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pl_qutr: str | None = Field(None, alias='pl_qutr', description='손익분기 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cap_support: str | None = Field(None, alias='cap_support', description='자본지지 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    elwexec_pric: str | None = Field(None, alias='elwexec_pric', description='ELW행사가 — 단위: 원')
    cnvt_rt: str | None = Field(None, alias='cnvt_rt', description='전환비율 — 단위: %, 부호 포함 소수점 넷째 자리까지 포맷된 백분율')
    elwexpr_dt: str | None = Field(None, alias='elwexpr_dt', description='ELW만기일 — YYYYMMDD')
    cntr_engg: str | None = Field(None, alias='cntr_engg', description='미결제약정')
    cntr_pred_pre: str | None = Field(None, alias='cntr_pred_pre', description='미결제전일대비')
    theory_pric: str | None = Field(None, alias='theory_pric', description='이론가')
    innr_vltl: str | None = Field(None, alias='innr_vltl', description='내재변동성')
    delta: str | None = Field(None, alias='delta', description='델타')
    gam: str | None = Field(None, alias='gam', description='감마')
    theta: str | None = Field(None, alias='theta', description='쎄타')
    vega: str | None = Field(None, alias='vega', description='베가')
    law: str | None = Field(None, alias='law', description='로')


class Ka10095Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10095'
    atn_stk_infr: list[Ka10095ResponseAtnStkInfrItem] = Field(default_factory=list, alias='atn_stk_infr', description='관심종목정보')


class Ka10098Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10098'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체,001:코스피,101:코스닥')
    sort_base: str = Field(..., alias='sort_base', description='정렬기준 — 1:상승률, 2:상승폭, 3:하락률, 4:하락폭, 5:보합')
    stk_cnd: str = Field(..., alias='stk_cnd', description='종목조건 — 0:전체조회,1:관리종목제외,2:정리매매종목제외,3:우선주제외,4:관리종목우선주제외,5:증100제외,6:증100만보기,7:증40만보기,8:증30만보기,9:증20만보기,12:증50만보기,13:증60만보기,14:ETF제외,15:스팩제외,16:ETF+ETN제외,17:ETN제외')
    trde_qty_cnd: str = Field(..., alias='trde_qty_cnd', description='거래량조건 — 0:전체조회, 10:백주이상,50:5백주이상,100;천주이상, 500:5천주이상, 1000:만주이상, 5000:5만주이상, 10000:10만주이상')
    crd_cnd: str = Field(..., alias='crd_cnd', description='신용조건 — 0:전체조회, 9:신용융자전체, 1:신용융자A군, 2:신용융자B군, 3:신용융자C군, 4:신용융자D군, 7:신용융자E군, 8:신용대주, 5:신용한도초과제외')
    trde_prica: str = Field(..., alias='trde_prica', description='거래대금 — 0:전체조회, 5:5백만원이상,10:1천만원이상, 30:3천만원이상, 50:5천만원이상, 100:1억원이상, 300:3억원이상, 500:5억원이상, 1000:10억원이상, 3000:30억원이상, 5000:50억원이상, 10000:100억원이상')


class Ka10098ResponseOvtSigpricFluRtRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_tot_req: str | None = Field(None, alias='sel_tot_req', description='매도총잔량 — 단위: 1주')
    buy_tot_req: str | None = Field(None, alias='buy_tot_req', description='매수총잔량 — 단위: 1주')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 백만원')
    tdy_close_pric: str | None = Field(None, alias='tdy_close_pric', description='당일종가 — 단위: 원')
    tdy_close_pric_flu_rt: str | None = Field(None, alias='tdy_close_pric_flu_rt', description='당일종가등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10098Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10098'
    ovt_sigpric_flu_rt_rank: list[Ka10098ResponseOvtSigpricFluRtRankItem] = Field(default_factory=list, alias='ovt_sigpric_flu_rt_rank', description='시간외단일가등락율순위')


class Ka10099Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10099'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0 : 코스피,\n10 : 코스닥,\n30 : K-OTC,\n50 : 코넥스,\n60 : ETN,\n70 : 손실제한 ETN,\n80 : 금현물,\n90 : 변동성 ETN,\n2 : 인프라투융자,\n3 : ELW,\n4 : 뮤추얼펀드,\n5 : 신주인수권,\n6 : 리츠종목,\n7 : 신주인수권증서,\n8 : ETF,\n9 : 하이일드펀드')


class Ka10099ResponseListItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    code: str | None = Field(None, alias='code', description='종목코드 — 단축코드')
    name: str | None = Field(None, alias='name', description='종목명')
    listCount: str | None = Field(None, alias='listCount', description='상장주식수 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 16자리 숫자')
    auditInfo: str | None = Field(None, alias='auditInfo', description='감리구분')
    regDay: str | None = Field(None, alias='regDay', description='상장일 — YYYYMMDD')
    lastPrice: str | None = Field(None, alias='lastPrice', description='전일종가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 8자리 숫자')
    state: str | None = Field(None, alias='state', description='종목상태')
    marketCode: str | None = Field(None, alias='marketCode', description='시장구분코드')
    marketName: str | None = Field(None, alias='marketName', description='시장명')
    upName: str | None = Field(None, alias='upName', description='업종명')
    upSizeName: str | None = Field(None, alias='upSizeName', description='회사크기분류')
    companyClassName: str | None = Field(None, alias='companyClassName', description='회사분류 — 코스닥만 존재함')
    orderWarning: str | None = Field(None, alias='orderWarning', description='투자유의종목여부 — 0: 해당없음, 2: 정리매매, 3: 단기과열, 4: 투자위험, 5: 투자경과, 1: ETF투자주의요망(ETF인 경우만 전달')
    nxtEnable: str | None = Field(None, alias='nxtEnable', description='NXT가능여부 — Y: 가능')


class Ka10099Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10099'
    list_: list[Ka10099ResponseListItem] = Field(default_factory=list, alias='list', description='종목리스트')


class Ka10100Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10100'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 종목코드 6자리')


class Ka10100Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10100'
    code: str | None = Field(None, alias='code', description='종목코드 — 단축코드')
    name: str | None = Field(None, alias='name', description='종목명')
    listCount: str | None = Field(None, alias='listCount', description='상장주식수 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 16자리 숫자')
    auditInfo: str | None = Field(None, alias='auditInfo', description='감리구분')
    regDay: str | None = Field(None, alias='regDay', description='상장일 — YYYYMMDD')
    lastPrice: str | None = Field(None, alias='lastPrice', description='전일종가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 8자리 숫자')
    state: str | None = Field(None, alias='state', description='종목상태')
    marketCode: str | None = Field(None, alias='marketCode', description='시장구분코드')
    marketName: str | None = Field(None, alias='marketName', description='시장명')
    upName: str | None = Field(None, alias='upName', description='업종명')
    upSizeName: str | None = Field(None, alias='upSizeName', description='회사크기분류')
    companyClassName: str | None = Field(None, alias='companyClassName', description='회사분류 — 코스닥만 존재함')
    orderWarning: str | None = Field(None, alias='orderWarning', description='투자유의종목여부 — 0: 해당없음, 2: 정리매매, 3: 단기과열, 4: 투자위험, 5: 투자경과, 1: ETF투자주의요망(ETF인 경우만 전달')
    nxtEnable: str | None = Field(None, alias='nxtEnable', description='NXT가능여부 — Y: 가능')


class Ka10101Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10101'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:코스피(거래소),1:코스닥,2:KOSPI200,4:KOSPI100,7:KRX100(통합지수)')


class Ka10101ResponseListItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    marketCode: str | None = Field(None, alias='marketCode', description='시장구분코드')
    code: str | None = Field(None, alias='code', description='코드')
    name: str | None = Field(None, alias='name', description='업종명')
    group: str | None = Field(None, alias='group', description='그룹')


class Ka10101Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10101'
    list_: list[Ka10101ResponseListItem] = Field(default_factory=list, alias='list', description='업종코드리스트')


class Ka10102Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10102'


class Ka10102ResponseListItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    code: str | None = Field(None, alias='code', description='코드')
    name: str | None = Field(None, alias='name', description='업종명')
    gb: str | None = Field(None, alias='gb', description='구분')


class Ka10102Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10102'
    list_: list[Ka10102ResponseListItem] = Field(default_factory=list, alias='list', description='회원사코드리스트')


class Ka10131Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10131'
    dt: str = Field(..., alias='dt', description='기간 — 1:최근일, 3:3일, 5:5일, 10:10일, 20:20일, 120:120일, 0:시작일자/종료일자로 조회')
    strt_dt: str | None = Field(None, alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='장구분 — 001:코스피, 101:코스닥')
    netslmt_tp: str = Field(..., alias='netslmt_tp', description='순매도수구분 — 2:순매수(고정값)')
    stk_inds_tp: str = Field(..., alias='stk_inds_tp', description='종목업종구분 — 0:종목(주식),1:업종')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 0:금액, 1:수량')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka10131ResponseOrgnFrgnrContTrdePrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    prid_stkpc_flu_rt: str | None = Field(None, alias='prid_stkpc_flu_rt', description='기간중주가등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    orgn_nettrde_amt: str | None = Field(None, alias='orgn_nettrde_amt', description='기관순매매금액 — 단위: 백만원, 부호가 포함된 숫자')
    orgn_nettrde_qty: str | None = Field(None, alias='orgn_nettrde_qty', description='기관순매매량 — 단위: 1주, 부호가 포함된 숫자')
    orgn_cont_netprps_dys: str | None = Field(None, alias='orgn_cont_netprps_dys', description='기관계연속순매수일수 — 부호가 포함된 숫자')
    orgn_cont_netprps_qty: str | None = Field(None, alias='orgn_cont_netprps_qty', description='기관계연속순매수량 — 단위: 1주, 부호가 포함된 숫자')
    orgn_cont_netprps_amt: str | None = Field(None, alias='orgn_cont_netprps_amt', description='기관계연속순매수금액 — 단위: 백만원, 부호가 포함된 숫자')
    frgnr_nettrde_qty: str | None = Field(None, alias='frgnr_nettrde_qty', description='외국인순매매량 — 단위: 1주, 부호가 포함된 숫자')
    frgnr_nettrde_amt: str | None = Field(None, alias='frgnr_nettrde_amt', description='외국인순매매액 — 단위: 백만원, 부호가 포함된 숫자')
    frgnr_cont_netprps_dys: str | None = Field(None, alias='frgnr_cont_netprps_dys', description='외국인연속순매수일수 — 부호가 포함된 숫자')
    frgnr_cont_netprps_qty: str | None = Field(None, alias='frgnr_cont_netprps_qty', description='외국인연속순매수량 — 단위: 1주, 부호가 포함된 숫자')
    frgnr_cont_netprps_amt: str | None = Field(None, alias='frgnr_cont_netprps_amt', description='외국인연속순매수금액 — 단위: 백만원, 부호가 포함된 숫자')
    nettrde_qty: str | None = Field(None, alias='nettrde_qty', description='순매매량 — 단위: 1주, 부호가 포함된 숫자')
    nettrde_amt: str | None = Field(None, alias='nettrde_amt', description='순매매액 — 단위: 백만원, 부호가 포함된 숫자')
    tot_cont_netprps_dys: str | None = Field(None, alias='tot_cont_netprps_dys', description='합계연속순매수일수 — 부호가 포함된 숫자')
    tot_cont_nettrde_qty: str | None = Field(None, alias='tot_cont_nettrde_qty', description='합계연속순매매수량 — 단위: 1주, 부호가 포함된 숫자')
    tot_cont_netprps_amt: str | None = Field(None, alias='tot_cont_netprps_amt', description='합계연속순매수금액 — 단위: 백만원, 부호가 포함된 숫자')


class Ka10131Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10131'
    orgn_frgnr_cont_trde_prst: list[Ka10131ResponseOrgnFrgnrContTrdePrstItem] = Field(default_factory=list, alias='orgn_frgnr_cont_trde_prst', description='기관외국인연속매매현황')


class Ka10170Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10170'
    base_dt: str | None = Field(None, alias='base_dt', description='기준일자 — YYYYMMDD(공백입력시 금일데이터,최근 2개월까지 제공)')
    ottks_tp: str = Field(..., alias='ottks_tp', description='단주구분 — 1:당일매수에 대한 당일매도,2:당일매도 전체')
    ch_crd_tp: str = Field(..., alias='ch_crd_tp', description='현금신용구분 — 0:전체, 1:현금매매만, 2:신용매매만')


class Ka10170ResponseTdyTrdeDiaryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    buy_avg_pric: str | None = Field(None, alias='buy_avg_pric', description='매수평균가 — 단위: 원')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량 — 단위: 1주')
    sel_avg_pric: str | None = Field(None, alias='sel_avg_pric', description='매도평균가 — 단위: 원')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량 — 단위: 1주')
    cmsn_alm_tax: str | None = Field(None, alias='cmsn_alm_tax', description='수수료_제세금 — 단위: 원')
    pl_amt: str | None = Field(None, alias='pl_amt', description='손익금액 — 단위: 원')
    sell_amt: str | None = Field(None, alias='sell_amt', description='매도금액 — 단위: 원')
    buy_amt: str | None = Field(None, alias='buy_amt', description='매수금액 — 단위: 원')
    prft_rt: str | None = Field(None, alias='prft_rt', description='수익률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')


class Ka10170Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10170'
    tot_sell_amt: str | None = Field(None, alias='tot_sell_amt', description='총매도금액 — 단위: 원')
    tot_buy_amt: str | None = Field(None, alias='tot_buy_amt', description='총매수금액 — 단위: 원')
    tot_cmsn_tax: str | None = Field(None, alias='tot_cmsn_tax', description='총수수료_세금 — 단위: 원')
    tot_exct_amt: str | None = Field(None, alias='tot_exct_amt', description='총정산금액 — 단위: 원')
    tot_pl_amt: str | None = Field(None, alias='tot_pl_amt', description='총손익금액 — 단위: 원')
    tot_prft_rt: str | None = Field(None, alias='tot_prft_rt', description='총수익률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    tdy_trde_diary: list[Ka10170ResponseTdyTrdeDiaryItem] = Field(default_factory=list, alias='tdy_trde_diary', description='당일매매일지')


class Ka10171Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10171'
    trnm: str = Field(..., alias='trnm', description='TR명 — CNSRLST고정값')


class Ka10171ResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    seq: str | None = Field(None, alias='seq', description='조건검색식 일련번호')
    name: str | None = Field(None, alias='name', description='조건검색식 명')


class Ka10171Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10171'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 정상 : 0')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 정상인 경우는 메시지 없음')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — CNSRLST 고정값')
    data: list[Ka10171ResponseDataItem] = Field(default_factory=list, alias='data', description='조건검색식 목록')


class Ka10172Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10172'
    trnm: str = Field(..., alias='trnm', description='서비스명 — CNSRREQ 고정값')
    seq: str = Field(..., alias='seq', description='조건검색식 일련번호')
    search_type: str = Field(..., alias='search_type', description='조회타입 — 0:조건검색')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — K:KRX')
    cont_yn: str | None = Field(None, alias='cont_yn', description='연속조회여부 — Y:연속조회요청,N:연속조회미요청')
    next_key: str | None = Field(None, alias='next_key', description='연속조회키')


class Ka10172ResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    f_9001: str | None = Field(None, alias='9001', description='종목코드 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    f_302: str | None = Field(None, alias='302', description='종목명')
    f_10: str | None = Field(None, alias='10', description='현재가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 9자리 숫자')
    f_25: str | None = Field(None, alias='25', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    f_11: str | None = Field(None, alias='11', description='전일대비 — 단위: 원, 좌측 0-padding 처리된 부호 포함 9자리 숫자')
    f_12: str | None = Field(None, alias='12', description="등락율 — 단위: 원, 좌측 0-padding 처리된 부호 포함 9자리 숫자 \n※ '000001500' 값은 +1.50%, '-00001500' 값은 -1.50%를 의미합니다.")
    f_13: str | None = Field(None, alias='13', description='누적거래량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 9자리 숫자')
    f_16: str | None = Field(None, alias='16', description='시가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 9자리 숫자')
    f_17: str | None = Field(None, alias='17', description='고가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 9자리 숫자')
    f_18: str | None = Field(None, alias='18', description='저가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 9자리 숫자')


class Ka10172Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10172'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 정상:0 나머지:에러')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 정상인 경우는 메시지 없음')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — CNSRREQ')
    seq: str | None = Field(None, alias='seq', description='조건검색식 일련번호')
    cont_yn: str | None = Field(None, alias='cont_yn', description='연속조회여부 — 연속 데이터가 존재하는경우 Y, 없으면 N')
    next_key: str | None = Field(None, alias='next_key', description='연속조회키 — 연속조회여부가Y일경우 다음 조회시 필요한 조회값')
    data: list[Ka10172ResponseDataItem] = Field(default_factory=list, alias='data', description='검색결과데이터')


class Ka10173Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10173'
    trnm: str = Field(..., alias='trnm', description='서비스명 — CNSRREQ 고정값')
    seq: str = Field(..., alias='seq', description='조건검색식 일련번호')
    search_type: str = Field(..., alias='search_type', description='조회타입 — 1: 조건검색+실시간조건검색')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — K:KRX')


class Ka10173ResponseDataItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    jmcode: str | None = Field(None, alias='jmcode', description='종목코드 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')


class Ka10173ResponseData2Item(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')


class Ka10173Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10173'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 정상:0 나머지:에러')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 정상인 경우는 메시지 없음')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — CNSRREQ')
    seq: str | None = Field(None, alias='seq', description='조건검색식 일련번호')
    data: list[Ka10173ResponseDataItem] = Field(default_factory=list, alias='data', description='검색결과데이터')
    data_2: list[Ka10173ResponseData2Item] = Field(default_factory=list, alias='data', description='검색결과데이터')
    trnm_2: str | None = Field(None, alias='trnm', description='서비스명 — REAL')
    type_: str | None = Field(None, alias='type', description='실시간 항목 — TR 명(0A,0B....)')
    name: str | None = Field(None, alias='name', description='실시간 항목명 — 종목코드')
    values: dict[str, Any] | None = Field(None, alias='values', description='실시간 수신 값')
    f_841: str | None = Field(None, alias='841', description='일련번호')
    f_9001: str | None = Field(None, alias='9001', description='종목코드')
    f_843: str | None = Field(None, alias='843', description='삽입삭제 구분 — I: 삽입, D: 삭제')
    f_20: str | None = Field(None, alias='20', description='체결시간')
    f_907: str | None = Field(None, alias='907', description='매도/수 구분')


class Ka10174Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka10174'
    trnm: str = Field(..., alias='trnm', description='서비스명 — CNSRCLR 고정값')
    seq: str = Field(..., alias='seq', description='조건검색식 일련번호')


class Ka10174Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10174'
    return_code: str | None = Field(None, alias='return_code', description='결과코드 — 정상:0 나머지:에러')
    return_msg: str | None = Field(None, alias='return_msg', description='결과메시지 — 정상인 경우는 메시지 없음')
    trnm: str | None = Field(None, alias='trnm', description='서비스명 — CNSRCLR 고정값')
    seq: str | None = Field(None, alias='seq', description='조건검색식 일련번호')


class Ka20001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20001'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:코스피, 1:코스닥, 2:코스피200')
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')


class Ka20001ResponseIndsCurPrcTmItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm_n: str | None = Field(None, alias='tm_n', description='시간n — HHmmss')
    cur_prc_n: str | None = Field(None, alias='cur_prc_n', description='현재가n — 단위: 지수, 부호가 포함된 숫자')
    pred_pre_sig_n: str | None = Field(None, alias='pred_pre_sig_n', description='전일대비기호n — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre_n: str | None = Field(None, alias='pred_pre_n', description='전일대비n — 단위: 지수, 부호가 포함된 숫자')
    flu_rt_n: str | None = Field(None, alias='flu_rt_n', description='등락률n — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty_n: str | None = Field(None, alias='trde_qty_n', description='거래량n — 단위: 1000주')
    acc_trde_qty_n: str | None = Field(None, alias='acc_trde_qty_n', description='누적거래량n — 단위: 1000주')


class Ka20001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20001'
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 지수, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1000주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    trde_frmatn_stk_num: str | None = Field(None, alias='trde_frmatn_stk_num', description='거래형성종목수 — 단위: 종목수')
    trde_frmatn_rt: str | None = Field(None, alias='trde_frmatn_rt', description='거래형성비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수, 부호가 포함된 숫자')
    upl: str | None = Field(None, alias='upl', description='상한 — 단위: 종목수')
    rising: str | None = Field(None, alias='rising', description='상승 — 단위: 종목수')
    stdns: str | None = Field(None, alias='stdns', description='보합 — 단위: 종목수')
    fall: str | None = Field(None, alias='fall', description='하락 — 단위: 종목수')
    lst: str | None = Field(None, alias='lst', description='하한 — 단위: 종목수')
    f_52wk_hgst_pric: str | None = Field(None, alias='52wk_hgst_pric', description='52주최고가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_hgst_pric_dt: str | None = Field(None, alias='52wk_hgst_pric_dt', description='52주최고가일 — YYYYMMDD')
    f_52wk_hgst_pric_pre_rt: str | None = Field(None, alias='52wk_hgst_pric_pre_rt', description='52주최고가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_52wk_lwst_pric: str | None = Field(None, alias='52wk_lwst_pric', description='52주최저가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_lwst_pric_dt: str | None = Field(None, alias='52wk_lwst_pric_dt', description='52주최저가일 — YYYYMMDD')
    f_52wk_lwst_pric_pre_rt: str | None = Field(None, alias='52wk_lwst_pric_pre_rt', description='52주최저가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    inds_cur_prc_tm: list[Ka20001ResponseIndsCurPrcTmItem] = Field(default_factory=list, alias='inds_cur_prc_tm', description='업종현재가_시간별')


class Ka20002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20002'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:코스피, 1:코스닥, 2:코스피200')
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka20002ResponseIndsStkpcItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    now_trde_qty: str | None = Field(None, alias='now_trde_qty', description='현재거래량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')


class Ka20002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20002'
    inds_stkpc: list[Ka20002ResponseIndsStkpcItem] = Field(default_factory=list, alias='inds_stkpc', description='업종별주가')


class Ka20003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20003'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 101:종합(KOSDAQ)')


class Ka20003ResponseAllIndsIdexItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 지수, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1000주')
    wght: str | None = Field(None, alias='wght', description='비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    upl: str | None = Field(None, alias='upl', description='상한 — 단위: 종목수')
    rising: str | None = Field(None, alias='rising', description='상승 — 단위: 종목수')
    stdns: str | None = Field(None, alias='stdns', description='보합 — 단위: 종목수')
    fall: str | None = Field(None, alias='fall', description='하락 — 단위: 종목수')
    lst: str | None = Field(None, alias='lst', description='하한 — 단위: 종목수')
    flo_stk_num: str | None = Field(None, alias='flo_stk_num', description='상장종목수 — 단위: 종목수')


class Ka20003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20003'
    all_inds_idex: list[Ka20003ResponseAllIndsIdexItem] = Field(default_factory=list, alias='all_inds_idex', description='전업종지수')


class Ka20004Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20004'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1틱, 3:3틱, 5:5틱, 10:10틱, 30:30틱')


class Ka20004ResponseIndsTicChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비 기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka20004Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20004'
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_tic_chart_qry: list[Ka20004ResponseIndsTicChartQryItem] = Field(default_factory=list, alias='inds_tic_chart_qry', description='업종틱차트조회')


class Ka20005Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20005'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1분, 3:3분, 5:5분, 10:10분, 15:15분, 30:30분, 45:45분, 60:60분')
    base_dt: str | None = Field(None, alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka20005ResponseIndsMinPoleQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 현재가 - 전일종가')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비 기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka20005Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20005'
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_min_pole_qry: list[Ka20005ResponseIndsMinPoleQryItem] = Field(default_factory=list, alias='inds_min_pole_qry', description='업종분봉조회')


class Ka20006Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20006'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka20006ResponseIndsDtPoleQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka20006Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20006'
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_dt_pole_qry: list[Ka20006ResponseIndsDtPoleQryItem] = Field(default_factory=list, alias='inds_dt_pole_qry', description='업종일봉조회')


class Ka20007Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20007'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka20007ResponseIndsStkPoleQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka20007Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20007'
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_stk_pole_qry: list[Ka20007ResponseIndsStkPoleQryItem] = Field(default_factory=list, alias='inds_stk_pole_qry', description='업종주봉조회')


class Ka20008Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20008'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka20008ResponseIndsMthPoleQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금')


class Ka20008Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20008'
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_mth_pole_qry: list[Ka20008ResponseIndsMthPoleQryItem] = Field(default_factory=list, alias='inds_mth_pole_qry', description='업종월봉조회')


class Ka20009Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20009'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:코스피, 1:코스닥, 2:코스피200')
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')


class Ka20009ResponseIndsCurPrcDalyReptItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt_n: str | None = Field(None, alias='dt_n', description='일자n — YYYYMMDD')
    cur_prc_n: str | None = Field(None, alias='cur_prc_n', description='현재가n — 단위: 지수, 부호가 포함된 숫자')
    pred_pre_sig_n: str | None = Field(None, alias='pred_pre_sig_n', description='전일대비기호n — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre_n: str | None = Field(None, alias='pred_pre_n', description='전일대비n — 단위: 지수, 부호가 포함된 숫자')
    flu_rt_n: str | None = Field(None, alias='flu_rt_n', description='등락률n — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty_n: str | None = Field(None, alias='acc_trde_qty_n', description='누적거래량n — 단위: 1000주')


class Ka20009Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20009'
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 지수, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1000주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    trde_frmatn_stk_num: str | None = Field(None, alias='trde_frmatn_stk_num', description='거래형성종목수 — 단위: 종목수')
    trde_frmatn_rt: str | None = Field(None, alias='trde_frmatn_rt', description='거래형성비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수, 부호가 포함된 숫자')
    upl: str | None = Field(None, alias='upl', description='상한 — 단위: 종목수')
    rising: str | None = Field(None, alias='rising', description='상승 — 단위: 종목수')
    stdns: str | None = Field(None, alias='stdns', description='보합 — 단위: 종목수')
    fall: str | None = Field(None, alias='fall', description='하락 — 단위: 종목수')
    lst: str | None = Field(None, alias='lst', description='하한 — 단위: 종목수')
    f_52wk_hgst_pric: str | None = Field(None, alias='52wk_hgst_pric', description='52주최고가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_hgst_pric_dt: str | None = Field(None, alias='52wk_hgst_pric_dt', description='52주최고가일 — YYYYMMDD')
    f_52wk_hgst_pric_pre_rt: str | None = Field(None, alias='52wk_hgst_pric_pre_rt', description='52주최고가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_52wk_lwst_pric: str | None = Field(None, alias='52wk_lwst_pric', description='52주최저가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_lwst_pric_dt: str | None = Field(None, alias='52wk_lwst_pric_dt', description='52주최저가일 — YYYYMMDD')
    f_52wk_lwst_pric_pre_rt: str | None = Field(None, alias='52wk_lwst_pric_pre_rt', description='52주최저가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    inds_cur_prc_daly_rept: list[Ka20009ResponseIndsCurPrcDalyReptItem] = Field(default_factory=list, alias='inds_cur_prc_daly_rept', description='업종현재가_일별반복')


class Ka20019Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20019'
    inds_cd: str = Field(..., alias='inds_cd', description='업종코드 — 001:종합(KOSPI), 002:대형주, 003:중형주, 004:소형주 101:종합(KOSDAQ), 201:KOSPI200, 302:KOSTAR, 701: KRX100 나머지 ※ 업종코드 참고')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka20019ResponseIndsYrPoleQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수\n\n※ 지수 값은 소수점 제거 된 100배 값으로 제공됩니다.')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka20019Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20019'
    inds_cd: str | None = Field(None, alias='inds_cd', description='업종코드')
    inds_yr_pole_qry: list[Ka20019ResponseIndsYrPoleQryItem] = Field(default_factory=list, alias='inds_yr_pole_qry', description='업종년봉조회')


class Ka20068Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka20068'
    strt_dt: str | None = Field(None, alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD')
    all_tp: str | None = Field(None, alias='all_tp', description='전체구분 — 0:종목코드 입력종목만 표시')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka20068ResponseDbrtTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    dbrt_trde_cntrcnt: str | None = Field(None, alias='dbrt_trde_cntrcnt', description='대차거래체결주수 — 단위: 1주')
    dbrt_trde_rpy: str | None = Field(None, alias='dbrt_trde_rpy', description='대차거래상환주수 — 단위: 1주')
    dbrt_trde_irds: str | None = Field(None, alias='dbrt_trde_irds', description='대차거래증감 — 단위: 1주')
    rmnd: str | None = Field(None, alias='rmnd', description='잔고주수 — 단위: 1주')
    remn_amt: str | None = Field(None, alias='remn_amt', description='잔고금액 — 단위: 백만원')


class Ka20068Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20068'
    dbrt_trde_trnsn: list[Ka20068ResponseDbrtTrdeTrnsnItem] = Field(default_factory=list, alias='dbrt_trde_trnsn', description='대차거래추이')


class Ka30001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30001'
    flu_tp: str = Field(..., alias='flu_tp', description='등락구분 — 1:급등, 2:급락')
    tm_tp: str = Field(..., alias='tm_tp', description='시간구분 — 1:분전, 2:일전')
    tm: str = Field(..., alias='tm', description='시간 — 분 혹은 일입력 (예 1, 3, 5)')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0:전체, 10:만주이상, 50:5만주이상, 100:10만주이상, 300:30만주이상, 500:50만주이상, 1000:백만주이상')
    isscomp_cd: str = Field(..., alias='isscomp_cd', description='발행사코드 — 전체:000000000000, 한국투자증권:3, 미래대우:5, 신영:6, NK투자증권:12, KB증권:17')
    bsis_aset_cd: str = Field(..., alias='bsis_aset_cd', description='기초자산코드 — 전체:000000000000, KOSPI200:201, KOSDAQ150:150, 삼성전자:005930, KT:030200..')
    rght_tp: str = Field(..., alias='rght_tp', description='권리구분 — 000:전체, 001:콜, 002:풋, 003:DC, 004:DP, 005:EX, 006:조기종료콜, 007:조기종료풋')
    lpcd: str = Field(..., alias='lpcd', description='LP코드 — 전체:000000000000, 한국투자증권:3, 미래대우:5, 신영:6, NK투자증권:12, KB증권:17')
    trde_end_elwskip: str = Field(..., alias='trde_end_elwskip', description='거래종료ELW제외 — 0:포함, 1:제외')


class Ka30001ResponseElwpricJmpfluItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_end_elwbase_pric: str | None = Field(None, alias='trde_end_elwbase_pric', description='거래종료ELW기준가 — 단위: 원')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    base_pre: str | None = Field(None, alias='base_pre', description='기준대비 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    jmp_rt: str | None = Field(None, alias='jmp_rt', description='급등율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka30001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30001'
    base_pric_tm: str | None = Field(None, alias='base_pric_tm', description='기준가시간')
    elwpric_jmpflu: list[Ka30001ResponseElwpricJmpfluItem] = Field(default_factory=list, alias='elwpric_jmpflu', description='ELW가격급등락')


class Ka30002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30002'
    isscomp_cd: str = Field(..., alias='isscomp_cd', description='발행사코드 — 3자리, 영웅문4 0273화면참조 (교보:001, 신한금융투자:002, 한국투자증권:003, 대신:004, 미래대우:005, ,,,)')
    trde_qty_tp: str = Field(..., alias='trde_qty_tp', description='거래량구분 — 0:전체, 5:5천주, 10:만주, 50:5만주, 100:10만주, 500:50만주, 1000:백만주')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:순매수, 2:순매도')
    dt: str = Field(..., alias='dt', description='기간 — 1:전일, 5:5일, 10:10일, 40:40일, 60:60일')
    trde_end_elwskip: str = Field(..., alias='trde_end_elwskip', description='거래종료ELW제외 — 0:포함, 1:제외')


class Ka30002ResponseTrdeOriElwnettrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    stkpc_flu: str | None = Field(None, alias='stkpc_flu', description='주가등락 — 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    netprps: str | None = Field(None, alias='netprps', description='순매수 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_qty: str | None = Field(None, alias='buy_trde_qty', description='매수거래량 — 단위: 1주')
    sel_trde_qty: str | None = Field(None, alias='sel_trde_qty', description='매도거래량 — 단위: 1주')


class Ka30002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30002'
    trde_ori_elwnettrde_upper: list[Ka30002ResponseTrdeOriElwnettrdeUpperItem] = Field(default_factory=list, alias='trde_ori_elwnettrde_upper', description='거래원별ELW순매매상위')


class Ka30003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30003'
    bsis_aset_cd: str = Field(..., alias='bsis_aset_cd', description='기초자산코드')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka30003ResponseElwlppossDalyTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_tp: str | None = Field(None, alias='pre_tp', description='대비구분')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    chg_qty: str | None = Field(None, alias='chg_qty', description='변동수량 — 단위: 1주')
    lprmnd_qty: str | None = Field(None, alias='lprmnd_qty', description='LP보유수량 — 단위: 1주')
    wght: str | None = Field(None, alias='wght', description='비중 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka30003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30003'
    elwlpposs_daly_trnsn: list[Ka30003ResponseElwlppossDalyTrnsnItem] = Field(default_factory=list, alias='elwlpposs_daly_trnsn', description='ELWLP보유일별추이')


class Ka30004Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30004'
    isscomp_cd: str = Field(..., alias='isscomp_cd', description='발행사코드 — 전체:000000000000, 한국투자증권:3, 미래대우:5, 신영:6, NK투자증권:12, KB증권:17')
    bsis_aset_cd: str = Field(..., alias='bsis_aset_cd', description='기초자산코드 — 전체:000000000000, KOSPI200:201, KOSDAQ150:150, 삼성전자:005930, KT:030200..')
    rght_tp: str = Field(..., alias='rght_tp', description='권리구분 — 000: 전체, 001: 콜, 002: 풋, 003: DC, 004: DP, 005: EX, 006: 조기종료콜, 007: 조기종료풋')
    lpcd: str = Field(..., alias='lpcd', description='LP코드 — 전체:000000000000, 한국투자증권:3, 미래대우:5, 신영:6, NK투자증권:12, KB증권:17')
    trde_end_elwskip: str = Field(..., alias='trde_end_elwskip', description='거래종료ELW제외 — 1:거래종료ELW제외, 0:거래종료ELW포함')


class Ka30004ResponseElwdisptyRtItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    isscomp_nm: str | None = Field(None, alias='isscomp_nm', description='발행사명')
    sqnc: str | None = Field(None, alias='sqnc', description='회차')
    base_aset_nm: str | None = Field(None, alias='base_aset_nm', description='기초자산명')
    rght_tp: str | None = Field(None, alias='rght_tp', description='권리구분')
    dispty_rt: str | None = Field(None, alias='dispty_rt', description='괴리율 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    basis: str | None = Field(None, alias='basis', description='베이시스 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    srvive_dys: str | None = Field(None, alias='srvive_dys', description='잔존일수')
    theory_pric: str | None = Field(None, alias='theory_pric', description='이론가 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_tp: str | None = Field(None, alias='pre_tp', description='대비구분 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')


class Ka30004Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30004'
    elwdispty_rt: list[Ka30004ResponseElwdisptyRtItem] = Field(default_factory=list, alias='elwdispty_rt', description='ELW괴리율')


class Ka30005Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30005'
    isscomp_cd: str = Field(..., alias='isscomp_cd', description='발행사코드 — 12자리입력(전체:000000000000, 한국투자증권:000,,,3, 미래대우:000,,,5, 신영:000,,,6, NK투자증권:000,,,12, KB증권:000,,,17)')
    bsis_aset_cd: str = Field(..., alias='bsis_aset_cd', description='기초자산코드 — 전체일때만 12자리입력(전체:000000000000, KOSPI200:201, KOSDAQ150:150, 삼정전자:005930, KT:030200,,)')
    rght_tp: str = Field(..., alias='rght_tp', description='권리구분 — 0:전체, 1:콜, 2:풋, 3:DC, 4:DP, 5:EX, 6:조기종료콜, 7:조기종료풋')
    lpcd: str = Field(..., alias='lpcd', description='LP코드 — 전체일때만 12자리입력(전체:000000000000, 한국투자증권:003, 미래대우:005, 신영:006, NK투자증권:012, KB증권:017)')
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 0:정렬없음, 1:상승율순, 2:상승폭순, 3:하락율순, 4:하락폭순, 5:거래량순, 6:거래대금순, 7:잔존일순')


class Ka30005ResponseElwcndQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    isscomp_nm: str | None = Field(None, alias='isscomp_nm', description='발행사명')
    sqnc: str | None = Field(None, alias='sqnc', description='회차')
    base_aset_nm: str | None = Field(None, alias='base_aset_nm', description='기초자산명')
    rght_tp: str | None = Field(None, alias='rght_tp', description='권리구분')
    expr_dt: str | None = Field(None, alias='expr_dt', description='만기일 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_tp: str | None = Field(None, alias='pre_tp', description='대비구분 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_qty_pre: str | None = Field(None, alias='trde_qty_pre', description='거래량대비 — 단위: 1주, 부호가 포함된 숫자')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    pred_trde_qty: str | None = Field(None, alias='pred_trde_qty', description='전일거래량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    prty: str | None = Field(None, alias='prty', description='패리티 — 소수점 둘째 자리까지 포맷된 숫자')
    gear_rt: str | None = Field(None, alias='gear_rt', description='기어링비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    pl_qutr_rt: str | None = Field(None, alias='pl_qutr_rt', description='손익분기율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cfp: str | None = Field(None, alias='cfp', description='자본지지점')
    theory_pric: str | None = Field(None, alias='theory_pric', description='이론가')
    innr_vltl: str | None = Field(None, alias='innr_vltl', description='내재변동성')
    delta: str | None = Field(None, alias='delta', description='델타')
    lvrg: str | None = Field(None, alias='lvrg', description='레버리지')
    exec_pric: str | None = Field(None, alias='exec_pric', description='행사가격 — 단위: 원')
    cnvt_rt: str | None = Field(None, alias='cnvt_rt', description='전환비율 — 소수점 넷째 자리까지 포맷된 숫자')
    lpposs_rt: str | None = Field(None, alias='lpposs_rt', description='LP보유비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pl_qutr_pt: str | None = Field(None, alias='pl_qutr_pt', description='손익분기점')
    fin_trde_dt: str | None = Field(None, alias='fin_trde_dt', description='최종거래일 — YYYYMMDD')
    flo_dt: str | None = Field(None, alias='flo_dt', description='상장일 — YYYYMMDD')
    lpinitlast_suply_dt: str | None = Field(None, alias='lpinitlast_suply_dt', description='LP초종공급일 — YYYYMMDD')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    srvive_dys: str | None = Field(None, alias='srvive_dys', description='잔존일수')
    dispty_rt: str | None = Field(None, alias='dispty_rt', description='괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    lpmmcm_nm: str | None = Field(None, alias='lpmmcm_nm', description='LP회원사명')
    lpmmcm_nm_1: str | None = Field(None, alias='lpmmcm_nm_1', description='LP회원사명1')
    lpmmcm_nm_2: str | None = Field(None, alias='lpmmcm_nm_2', description='LP회원사명2')
    xraymont_cntr_qty_arng_trde_tp: str | None = Field(None, alias='xraymont_cntr_qty_arng_trde_tp', description='Xray순간체결량정리매매구분')
    xraymont_cntr_qty_profa_100tp: str | None = Field(None, alias='xraymont_cntr_qty_profa_100tp', description='Xray순간체결량증거금100구분')


class Ka30005Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30005'
    elwcnd_qry: list[Ka30005ResponseElwcndQryItem] = Field(default_factory=list, alias='elwcnd_qry', description='ELW조건검색')


class Ka30009Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30009'
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:상승률, 2:상승폭, 3:하락률, 4:하락폭')
    rght_tp: str = Field(..., alias='rght_tp', description='권리구분 — 000:전체, 001:콜, 002:풋, 003:DC, 004:DP, 006:조기종료콜, 007:조기종료풋')
    trde_end_skip: str = Field(..., alias='trde_end_skip', description='거래종료제외 — 1:거래종료제외, 0:거래종료포함')


class Ka30009ResponseElwfluRtRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka30009Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30009'
    elwflu_rt_rank: list[Ka30009ResponseElwfluRtRankItem] = Field(default_factory=list, alias='elwflu_rt_rank', description='ELW등락율순위')


class Ka30010Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30010'
    sort_tp: str = Field(..., alias='sort_tp', description='정렬구분 — 1:순매수잔량상위, 2: 순매도 잔량상위')
    rght_tp: str = Field(..., alias='rght_tp', description='권리구분 — 000: 전체, 001: 콜, 002: 풋, 003: DC, 004: DP, 006: 조기종료콜, 007: 조기종료풋')
    trde_end_skip: str = Field(..., alias='trde_end_skip', description='거래종료제외 — 1:거래종료제외, 0:거래종료포함')


class Ka30010ResponseElwreqRankItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')
    netprps_req: str | None = Field(None, alias='netprps_req', description='순매수잔량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')


class Ka30010Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30010'
    elwreq_rank: list[Ka30010ResponseElwreqRankItem] = Field(default_factory=list, alias='elwreq_rank', description='ELW잔량순위')


class Ka30011Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30011'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka30011ResponseElwalaccRtItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    alacc_rt: str | None = Field(None, alias='alacc_rt', description='근접율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Ka30011Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30011'
    elwalacc_rt: list[Ka30011ResponseElwalaccRtItem] = Field(default_factory=list, alias='elwalacc_rt', description='ELW근접율')


class Ka30012Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka30012'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka30012Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    aset_cd: str | None = Field(None, alias='aset_cd', description='자산코드')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    lpmmcm_nm: str | None = Field(None, alias='lpmmcm_nm', description='LP회원사명')
    lpmmcm_nm_1: str | None = Field(None, alias='lpmmcm_nm_1', description='LP회원사명1')
    lpmmcm_nm_2: str | None = Field(None, alias='lpmmcm_nm_2', description='LP회원사명2')
    elwrght_cntn: str | None = Field(None, alias='elwrght_cntn', description='ELW권리내용')
    elwexpr_evlt_pric: str | None = Field(None, alias='elwexpr_evlt_pric', description='ELW만기평가가격')
    elwtheory_pric: str | None = Field(None, alias='elwtheory_pric', description='ELW이론가 — 소수점 제거 된 100배 값으로 제공\n \n예) "4234322"값은 42,344.22를 의미합니다.')
    dispty_rt: str | None = Field(None, alias='dispty_rt', description='괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    elwinnr_vltl: str | None = Field(None, alias='elwinnr_vltl', description='ELW내재변동성')
    exp_rght_pric: str | None = Field(None, alias='exp_rght_pric', description='예상권리가')
    elwpl_qutr_rt: str | None = Field(None, alias='elwpl_qutr_rt', description='ELW손익분기율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    elwexec_pric: str | None = Field(None, alias='elwexec_pric', description='ELW행사가')
    elwcnvt_rt: str | None = Field(None, alias='elwcnvt_rt', description='ELW전환비율 — 소수점 넷째 자리까지 포맷된 숫자')
    elwcmpn_rt: str | None = Field(None, alias='elwcmpn_rt', description='ELW보상율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    elwpric_rising_part_rt: str | None = Field(None, alias='elwpric_rising_part_rt', description='ELW가격상승참여율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    elwrght_type: str | None = Field(None, alias='elwrght_type', description='ELW권리유형')
    elwsrvive_dys: str | None = Field(None, alias='elwsrvive_dys', description='ELW잔존일수')
    stkcnt: str | None = Field(None, alias='stkcnt', description='상장주식수 — 단위: 천원')
    elwlpord_pos: str | None = Field(None, alias='elwlpord_pos', description='ELWLP주문가능')
    lpposs_rt: str | None = Field(None, alias='lpposs_rt', description='LP보유비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lprmnd_qty: str | None = Field(None, alias='lprmnd_qty', description='LP보유수량 — 단위: 1주')
    elwspread: str | None = Field(None, alias='elwspread', description='ELW스프레드 — 소수점 둘째 자리까지 포맷된 숫자')
    elwprty: str | None = Field(None, alias='elwprty', description='ELW패리티 — 소수점 둘째 자리까지 포맷된 숫자')
    elwgear: str | None = Field(None, alias='elwgear', description='ELW기어링 — 소수점 둘째 자리까지 포맷된 숫자')
    elwflo_dt: str | None = Field(None, alias='elwflo_dt', description='ELW상장일 — YYYYMMDD')
    elwfin_trde_dt: str | None = Field(None, alias='elwfin_trde_dt', description='ELW최종거래일 — YYYYMMDD')
    expr_dt: str | None = Field(None, alias='expr_dt', description='만기일 — YYYYMMDD')
    exec_dt: str | None = Field(None, alias='exec_dt', description='행사일 — YYYYMMDD')
    lpsuply_end_dt: str | None = Field(None, alias='lpsuply_end_dt', description='LP공급종료일 — YYYYMMDD')
    elwpay_dt: str | None = Field(None, alias='elwpay_dt', description='ELW지급일 — YYYYMMDD')
    elwinvt_ix_comput: str | None = Field(None, alias='elwinvt_ix_comput', description='ELW투자지표산출')
    elwpay_agnt: str | None = Field(None, alias='elwpay_agnt', description='ELW지급대리인')
    elwappr_way: str | None = Field(None, alias='elwappr_way', description='ELW결재방법')
    elwrght_exec_way: str | None = Field(None, alias='elwrght_exec_way', description='ELW권리행사방식')
    elwpblicte_orgn: str | None = Field(None, alias='elwpblicte_orgn', description='ELW발행기관')
    dcsn_pay_amt: str | None = Field(None, alias='dcsn_pay_amt', description='확정지급액 — 소수점 셋째 자리까지 포맷된 숫자')
    kobarr: str | None = Field(None, alias='kobarr', description='KO베리어')
    iv: str | None = Field(None, alias='iv', description='IV — 소수점 셋째 자리까지 포맷된 숫자')
    clsprd_end_elwocr: str | None = Field(None, alias='clsprd_end_elwocr', description='종기종료ELW발생')
    bsis_aset_1: str | None = Field(None, alias='bsis_aset_1', description='기초자산1')
    bsis_aset_comp_rt_1: str | None = Field(None, alias='bsis_aset_comp_rt_1', description='기초자산구성비율1 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_2: str | None = Field(None, alias='bsis_aset_2', description='기초자산2')
    bsis_aset_comp_rt_2: str | None = Field(None, alias='bsis_aset_comp_rt_2', description='기초자산구성비율2 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_3: str | None = Field(None, alias='bsis_aset_3', description='기초자산3')
    bsis_aset_comp_rt_3: str | None = Field(None, alias='bsis_aset_comp_rt_3', description='기초자산구성비율3 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_4: str | None = Field(None, alias='bsis_aset_4', description='기초자산4')
    bsis_aset_comp_rt_4: str | None = Field(None, alias='bsis_aset_comp_rt_4', description='기초자산구성비율4 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_5: str | None = Field(None, alias='bsis_aset_5', description='기초자산5')
    bsis_aset_comp_rt_5: str | None = Field(None, alias='bsis_aset_comp_rt_5', description='기초자산구성비율5 — 소수점 셋째 자리까지 포맷된 숫자')
    fr_dt: str | None = Field(None, alias='fr_dt', description='평가시작일자')
    to_dt: str | None = Field(None, alias='to_dt', description='평가종료일자')
    fr_tm: str | None = Field(None, alias='fr_tm', description='평가시작시간')
    evlt_end_tm: str | None = Field(None, alias='evlt_end_tm', description='평가종료시간')
    evlt_pric: str | None = Field(None, alias='evlt_pric', description='평가가격')
    evlt_fnsh_yn: str | None = Field(None, alias='evlt_fnsh_yn', description='평가완료여부')
    all_hgst_pric: str | None = Field(None, alias='all_hgst_pric', description='전체최고가')
    all_lwst_pric: str | None = Field(None, alias='all_lwst_pric', description='전체최저가')
    imaf_hgst_pric: str | None = Field(None, alias='imaf_hgst_pric', description='직후최고가')
    imaf_lwst_pric: str | None = Field(None, alias='imaf_lwst_pric', description='직후최저가')
    sndhalf_mrkt_hgst_pric: str | None = Field(None, alias='sndhalf_mrkt_hgst_pric', description='후반장최고가')
    sndhalf_mrkt_lwst_pric: str | None = Field(None, alias='sndhalf_mrkt_lwst_pric', description='후반장최저가')


class Ka40001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40001'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    etfobjt_idex_cd: str = Field(..., alias='etfobjt_idex_cd', description='ETF대상지수코드')
    dt: str = Field(..., alias='dt', description='기간 — 0:1주, 1:1달, 2:6개월, 3:1년')


class Ka40001ResponseEtfprftRtLstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    etfprft_rt: str | None = Field(None, alias='etfprft_rt', description='ETF수익률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cntr_prft_rt: str | None = Field(None, alias='cntr_prft_rt', description='체결수익률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    for_netprps_qty: str | None = Field(None, alias='for_netprps_qty', description='외인순매수수량')
    orgn_netprps_qty: str | None = Field(None, alias='orgn_netprps_qty', description='기관순매수수량')


class Ka40001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40001'
    etfprft_rt_lst: list[Ka40001ResponseEtfprftRtLstItem] = Field(default_factory=list, alias='etfprft_rt_lst', description='ETF수익율')


class Ka40002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40002'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40002'
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    etfobjt_idex_nm: str | None = Field(None, alias='etfobjt_idex_nm', description='ETF대상지수명')
    wonju_pric: str | None = Field(None, alias='wonju_pric', description='원주가격')
    etftxon_type: str | None = Field(None, alias='etftxon_type', description='ETF과세유형')
    etntxon_type: str | None = Field(None, alias='etntxon_type', description='ETN과세유형')


class Ka40003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40003'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40003ResponseEtfdalyTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_dt: str | None = Field(None, alias='cntr_dt', description='체결일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pre_rt: str | None = Field(None, alias='pre_rt', description='대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    nav: str | None = Field(None, alias='nav', description='NAV — 부호 포함 소수점 둘째 자리까지 포맷된 숫자')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적거래대금 — 단위: 1주')
    navidex_dispty_rt: str | None = Field(None, alias='navidex_dispty_rt', description='NAV/지수괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    navetfdispty_rt: str | None = Field(None, alias='navetfdispty_rt', description='NAV/ETF괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trace_eor_rt: str | None = Field(None, alias='trace_eor_rt', description='추적오차율 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    trace_cur_prc: str | None = Field(None, alias='trace_cur_prc', description='추적현재가 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    trace_pred_pre: str | None = Field(None, alias='trace_pred_pre', description='추적전일대비 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    trace_pre_sig: str | None = Field(None, alias='trace_pre_sig', description='추적대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka40003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40003'
    etfdaly_trnsn: list[Ka40003ResponseEtfdalyTrnsnItem] = Field(default_factory=list, alias='etfdaly_trnsn', description='ETF일별추이')


class Ka40004Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40004'
    txon_type: str = Field(..., alias='txon_type', description='과세유형 — 0:전체, 1:비과세, 2:보유기간과세, 3:회사형, 4:외국, 5:비과세해외(보유기간관세)')
    navpre: str = Field(..., alias='navpre', description='NAV대비 — 0:전체, 1:NAV > 전일종가, 2:NAV < 전일종가')
    mngmcomp: str = Field(..., alias='mngmcomp', description='운용사 — 0000:전체, 3020:KODEX(삼성), 3027:KOSEF(키움), 3191:TIGER(미래에셋), 3228:KINDEX(한국투자), 3023:KStar(KB), 3022:아리랑(한화), 9999:기타운용사')
    txon_yn: str = Field(..., alias='txon_yn', description='과세여부 — 0:전체, 1:과세, 2:비과세')
    trace_idex: str = Field(..., alias='trace_idex', description='추적지수 — 0:전체')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka40004ResponseEtfallMrprItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_cls: str | None = Field(None, alias='stk_cls', description='종목분류')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    pre_rt: str | None = Field(None, alias='pre_rt', description='대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    nav: str | None = Field(None, alias='nav', description='NAV — 부호 포함 소수점 둘째 자리까지 포맷된 숫자')
    trace_eor_rt: str | None = Field(None, alias='trace_eor_rt', description='추적오차율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    txbs: str | None = Field(None, alias='txbs', description='과표기준')
    dvid_bf_base: str | None = Field(None, alias='dvid_bf_base', description='배당전기준')
    pred_dvida: str | None = Field(None, alias='pred_dvida', description='전일배당금')
    trace_idex_nm: str | None = Field(None, alias='trace_idex_nm', description='추적지수명')
    drng: str | None = Field(None, alias='drng', description='배수')
    trace_idex_cd: str | None = Field(None, alias='trace_idex_cd', description='추적지수코드')
    trace_idex: str | None = Field(None, alias='trace_idex', description='추적지수')
    trace_flu_rt: str | None = Field(None, alias='trace_flu_rt', description='추적등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka40004Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40004'
    etfall_mrpr: list[Ka40004ResponseEtfallMrprItem] = Field(default_factory=list, alias='etfall_mrpr', description='ETF전체시세')


class Ka40006Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40006'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40006ResponseEtftislTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    close_pric: str | None = Field(None, alias='close_pric', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    nav: str | None = Field(None, alias='nav', description='NAV — 부호 포함 소수점 둘째 자리까지 포맷된 숫자')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    navidex: str | None = Field(None, alias='navidex', description='NAV지수 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    navetf: str | None = Field(None, alias='navetf', description='괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trace: str | None = Field(None, alias='trace', description='추적오차율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trace_idex: str | None = Field(None, alias='trace_idex', description='추적지수 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    trace_idex_pred_pre: str | None = Field(None, alias='trace_idex_pred_pre', description='추적지수전일대비 — 소수점 제거 된 100배 값으로 제공\n \n예) "2658"값은 26.58을 의미합니다.')
    trace_idex_pred_pre_sig: str | None = Field(None, alias='trace_idex_pred_pre_sig', description='추적지수전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka40006Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40006'
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    etfobjt_idex_nm: str | None = Field(None, alias='etfobjt_idex_nm', description='ETF대상지수명')
    wonju_pric: str | None = Field(None, alias='wonju_pric', description='원주가격')
    etftxon_type: str | None = Field(None, alias='etftxon_type', description='ETF과세유형')
    etntxon_type: str | None = Field(None, alias='etntxon_type', description='ETN과세유형')
    etftisl_trnsn: list[Ka40006ResponseEtftislTrnsnItem] = Field(default_factory=list, alias='etftisl_trnsn', description='ETF시간대별추이')


class Ka40007Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40007'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40007ResponseEtftislCntrArrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주, 부호가 포함된 숫자')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — KRX , NXT , 통합')


class Ka40007Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40007'
    stk_cls: str | None = Field(None, alias='stk_cls', description='종목분류')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    etfobjt_idex_nm: str | None = Field(None, alias='etfobjt_idex_nm', description='ETF대상지수명')
    etfobjt_idex_cd: str | None = Field(None, alias='etfobjt_idex_cd', description='ETF대상지수코드')
    objt_idex_pre_rt: str | None = Field(None, alias='objt_idex_pre_rt', description='대상지수대비율 — 소수점 둘째 자리까지 포맷된 숫자')
    wonju_pric: str | None = Field(None, alias='wonju_pric', description='원주가격')
    etftisl_cntr_array: list[Ka40007ResponseEtftislCntrArrayItem] = Field(default_factory=list, alias='etftisl_cntr_array', description='ETF시간대별체결배열')


class Ka40008Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40008'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40008ResponseEtfnetprpsQtyArrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc_n: str | None = Field(None, alias='cur_prc_n', description='현재가n — 단위: 원, 부호가 포함된 숫자')
    pre_sig_n: str | None = Field(None, alias='pre_sig_n', description='대비기호n — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre_n: str | None = Field(None, alias='pred_pre_n', description='전일대비n — 단위: 원, 부호가 포함된 숫자')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    for_netprps_qty: str | None = Field(None, alias='for_netprps_qty', description='외인순매수수량 — 단위: 1주, 부호가 포함된 숫자')
    orgn_netprps_qty: str | None = Field(None, alias='orgn_netprps_qty', description='기관순매수수량 — 단위: 1주, 부호가 포함된 숫자')


class Ka40008Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40008'
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주, 부호가 포함된 숫자')
    etfnetprps_qty_array: list[Ka40008ResponseEtfnetprpsQtyArrayItem] = Field(default_factory=list, alias='etfnetprps_qty_array', description='ETF순매수수량배열')


class Ka40009Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40009'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40009ResponseEtfnavarrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    nav: str | None = Field(None, alias='nav', description='NAV')
    navpred_pre: str | None = Field(None, alias='navpred_pre', description='NAV전일대비')
    navflu_rt: str | None = Field(None, alias='navflu_rt', description='NAV등락율')
    trace_eor_rt: str | None = Field(None, alias='trace_eor_rt', description='추적오차율')
    dispty_rt: str | None = Field(None, alias='dispty_rt', description='괴리율')
    stkcnt: str | None = Field(None, alias='stkcnt', description='주식수')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가')
    for_rmnd_qty: str | None = Field(None, alias='for_rmnd_qty', description='외인보유수량')
    repl_pric: str | None = Field(None, alias='repl_pric', description='대용가')
    conv_pric: str | None = Field(None, alias='conv_pric', description='환산가격')
    drstk: str | None = Field(None, alias='drstk', description='DR/주')
    wonju_pric: str | None = Field(None, alias='wonju_pric', description='원주가격')


class Ka40009Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40009'
    etfnavarray: list[Ka40009ResponseEtfnavarrayItem] = Field(default_factory=list, alias='etfnavarray', description='ETFNAV배열')


class Ka40010Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka40010'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')


class Ka40010ResponseEtftislTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    for_netprps: str | None = Field(None, alias='for_netprps', description='외인순매수 — 단위: 1주, 부호가 포함된 숫자')


class Ka40010Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka40010'
    etftisl_trnsn: list[Ka40010ResponseEtftislTrnsnItem] = Field(default_factory=list, alias='etftisl_trnsn', description='ETF시간대별추이')


class Ka50010Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50010'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')


class Ka50010ResponseGoldCntrItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일 대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='누적 거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금 — 단위: 원')
    cntr_trde_qty: str | None = Field(None, alias='cntr_trde_qty', description='거래량(체결량) — 단위: 1주')
    tm: str | None = Field(None, alias='tm', description='체결시간 — HHmmss')
    pre_sig: str | None = Field(None, alias='pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pri_sel_bid_unit: str | None = Field(None, alias='pri_sel_bid_unit', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    pri_buy_bid_unit: str | None = Field(None, alias='pri_buy_bid_unit', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    trde_pre: str | None = Field(None, alias='trde_pre', description='전일 거래량 대비 비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_tern_rt: str | None = Field(None, alias='trde_tern_rt', description='전일 거래량 대비 순간 거래량 비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Ka50010Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50010'
    gold_cntr: list[Ka50010ResponseGoldCntrItem] = Field(default_factory=list, alias='gold_cntr', description='금현물체결추이')


class Ka50012Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50012'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')


class Ka50012ResponseGoldDalyTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='종가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일 대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='누적 거래량 — 단위: 1000주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금(백만) — 단위: 백만원')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    pre_sig: str | None = Field(None, alias='pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    orgn_netprps: str | None = Field(None, alias='orgn_netprps', description='기관 순매수 수량 — 단위: 1000주')
    for_netprps: str | None = Field(None, alias='for_netprps', description='외국인 순매수 수량 — 단위: 1000주')
    ind_netprps: str | None = Field(None, alias='ind_netprps', description='순매매량(개인) — 단위: 1000주')


class Ka50012Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50012'
    gold_daly_trnsn: list[Ka50012ResponseGoldDalyTrnsnItem] = Field(default_factory=list, alias='gold_daly_trnsn', description='금현물일별추이')


class Ka50079Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50079'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1틱, 3:3틱, 5:5틱, 10:10틱, 30:30틱')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka50079ResponseGdsTicChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDDHHmmss')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka50079Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50079'
    gds_tic_chart_qry: list[Ka50079ResponseGdsTicChartQryItem] = Field(default_factory=list, alias='gds_tic_chart_qry', description='금현물틱차트조회')


class Ka50080Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50080'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1분, 3:3분, 5:5분, 10:10분, 15:15분, 30:30분, 45:45분, 60:60분')
    upd_stkpc_tp: str | None = Field(None, alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka50080ResponseGdsMinChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDDHHmmss')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka50080Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50080'
    gds_min_chart_qry: list[Ka50080ResponseGdsMinChartQryItem] = Field(default_factory=list, alias='gds_min_chart_qry', description='금현물분봉차트조회')


class Ka50081Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50081'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka50081ResponseGdsDayChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적 거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금 — 단위: 백만원')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka50081Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50081'
    gds_day_chart_qry: list[Ka50081ResponseGdsDayChartQryItem] = Field(default_factory=list, alias='gds_day_chart_qry', description='금현물일봉차트조회')


class Ka50082Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50082'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka50082ResponseGdsWeekChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적 거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금 — 단위: 백만원')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDDHHmmss')


class Ka50082Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50082'
    gds_week_chart_qry: list[Ka50082ResponseGdsWeekChartQryItem] = Field(default_factory=list, alias='gds_week_chart_qry', description='금현물일봉차트조회')


class Ka50083Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50083'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    base_dt: str = Field(..., alias='base_dt', description='기준일자 — YYYYMMDD')
    upd_stkpc_tp: str = Field(..., alias='upd_stkpc_tp', description='수정주가구분 — 0 or 1')


class Ka50083ResponseGdsMonthChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적 거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금 — 단위: 원')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDDHHmmss')


class Ka50083Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50083'
    gds_month_chart_qry: list[Ka50083ResponseGdsMonthChartQryItem] = Field(default_factory=list, alias='gds_month_chart_qry', description='금현물일봉차트조회')


class Ka50087Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50087'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')


class Ka50087ResponseGoldExptExecItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상 체결가 — 단위: 원, 부호가 포함된 숫자')
    exp_pred_pre: str | None = Field(None, alias='exp_pred_pre', description='예상 체결가 전일대비 — 단위: 원, 부호가 포함된 숫자')
    exp_flu_rt: str | None = Field(None, alias='exp_flu_rt', description='예상 체결가 등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    exp_acc_trde_qty: str | None = Field(None, alias='exp_acc_trde_qty', description='예상 체결 수량(누적)')
    exp_cntr_trde_qty: str | None = Field(None, alias='exp_cntr_trde_qty', description='예상 체결 수량')
    exp_tm: str | None = Field(None, alias='exp_tm', description='예상 체결 시간 — HHmmss')
    exp_pre_sig: str | None = Field(None, alias='exp_pre_sig', description='예상 체결가 전일대비기호')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소 구분')


class Ka50087Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50087'
    gold_expt_exec: list[Ka50087ResponseGoldExptExecItem] = Field(default_factory=list, alias='gold_expt_exec', description='금현물예상체결')


class Ka50091Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50091'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1틱, 3:3틱, 5:5틱, 10:10틱, 30:30틱')


class Ka50091ResponseGdsTicChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일 대비(원) — 단위: 원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량(체결량) — 단위: 1주')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDDHHmmss')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')


class Ka50091Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50091'
    gds_tic_chart_qry: list[Ka50091ResponseGdsTicChartQryItem] = Field(default_factory=list, alias='gds_tic_chart_qry', description='금현물일봉차트조회')


class Ka50092Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50092'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1분, 3:3분, 5:5분, 10:10분, 15:15분, 30:30분, 45:45분, 60:60분')


class Ka50092ResponseGdsMinChartQryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일 대비(원) — 단위: 원')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적 거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금 — 단위: 백만원')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량(체결량) — 단위: 1주')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDDHHmmss')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호')


class Ka50092Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50092'
    gds_min_chart_qry: list[Ka50092ResponseGdsMinChartQryItem] = Field(default_factory=list, alias='gds_min_chart_qry', description='금현물일봉차트조회')


class Ka50100Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50100'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000: 금 99.99_1kg, M04020100: 미니금 99.99_100g')


class Ka50100Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50100'
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    pred_rt: str | None = Field(None, alias='pred_rt', description='전일비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    upl_pric: str | None = Field(None, alias='upl_pric', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    lst_pric: str | None = Field(None, alias='lst_pric', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    pred_close_pric: str | None = Field(None, alias='pred_close_pric', description='전일종가 — 단위: 원')


class Ka50101Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka50101'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    tic_scope: str = Field(..., alias='tic_scope', description='틱범위 — 1:1틱, 3:3틱, 5:5틱, 10:10틱, 30:30틱')


class Ka50101ResponseGoldBidItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_pric: str | None = Field(None, alias='cntr_pric', description='체결가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일 대비(원) — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='누적 거래량 — 단위: 1주')
    acc_trde_prica: str | None = Field(None, alias='acc_trde_prica', description='누적 거래대금 — 단위: 백만원')
    cntr_trde_qty: str | None = Field(None, alias='cntr_trde_qty', description='거래량(체결량) — 단위: 1주')
    tm: str | None = Field(None, alias='tm', description='체결시간 — HHmmss')
    pre_sig: str | None = Field(None, alias='pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pri_sel_bid_unit: str | None = Field(None, alias='pri_sel_bid_unit', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    pri_buy_bid_unit: str | None = Field(None, alias='pri_buy_bid_unit', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    trde_pre: str | None = Field(None, alias='trde_pre', description='전일 거래량 대비 비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_tern_rt: str | None = Field(None, alias='trde_tern_rt', description='전일 거래량 대비 순간 거래량 비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    cntr_str: str | None = Field(None, alias='cntr_str', description='체결강도 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lpmmcm_nm_1: str | None = Field(None, alias='lpmmcm_nm_1', description='K.O 접근도')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분')


class Ka50101Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka50101'
    gold_bid: list[Ka50101ResponseGoldBidItem] = Field(default_factory=list, alias='gold_bid', description='금현물호가')


class Ka52301Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka52301'


class Ka52301ResponseInveTradStatItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    all_dfrt_trst_sell_qty: str | None = Field(None, alias='all_dfrt_trst_sell_qty', description='투자자별 매도 수량(천) — 단위: 1000주')
    sell_qty_irds: str | None = Field(None, alias='sell_qty_irds', description='투자자별 매도 수량 증감(천) — 단위: 1000주')
    all_dfrt_trst_sell_amt: str | None = Field(None, alias='all_dfrt_trst_sell_amt', description='투자자별 매도 금액(억) — 단위: 억원')
    sell_amt_irds: str | None = Field(None, alias='sell_amt_irds', description='투자자별 매도 금액 증감(억) — 단위: 억원')
    all_dfrt_trst_buy_qty: str | None = Field(None, alias='all_dfrt_trst_buy_qty', description='투자자별 매수 수량(천) — 단위: 1000주')
    buy_qty_irds: str | None = Field(None, alias='buy_qty_irds', description='투자자별 매수 수량 증감(천) — 단위: 1000주')
    all_dfrt_trst_buy_amt: str | None = Field(None, alias='all_dfrt_trst_buy_amt', description='투자자별 매수 금액(억) — 단위: 억원')
    buy_amt_irds: str | None = Field(None, alias='buy_amt_irds', description='투자자별 매수 금액 증감(억) — 단위: 억원')
    all_dfrt_trst_netprps_qty: str | None = Field(None, alias='all_dfrt_trst_netprps_qty', description='투자자별 순매수 수량(천) — 단위: 1000주')
    netprps_qty_irds: str | None = Field(None, alias='netprps_qty_irds', description='투자자별 순매수 수량 증감(천) — 단위: 1000주')
    all_dfrt_trst_netprps_amt: str | None = Field(None, alias='all_dfrt_trst_netprps_amt', description='투자자별 순매수 금액(억) — 단위: 억원')
    netprps_amt_irds: str | None = Field(None, alias='netprps_amt_irds', description='투자자별 순매수 금액 증감(억) — 단위: 억원')
    sell_uv: str | None = Field(None, alias='sell_uv', description='투자자별 매도 단가')
    buy_uv: str | None = Field(None, alias='buy_uv', description='투자자별 매수 단가')
    stk_nm: str | None = Field(None, alias='stk_nm', description='투자자 구분명')
    acc_netprps_amt: str | None = Field(None, alias='acc_netprps_amt', description='누적 순매수 금액(억) — 단위: 억원')
    acc_netprps_qty: str | None = Field(None, alias='acc_netprps_qty', description='누적 순매수 수량(천) — 단위: 1000주')
    stk_cd: str | None = Field(None, alias='stk_cd', description='투자자 코드')


class Ka52301Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka52301'
    inve_trad_stat: list[Ka52301ResponseInveTradStatItem] = Field(default_factory=list, alias='inve_trad_stat', description='금현물투자자현황')


class Ka90001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90001'
    qry_tp: str = Field(..., alias='qry_tp', description='검색구분 — 0:전체검색, 1:테마검색, 2:종목검색')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 검색하려는 종목코드')
    date_tp: str = Field(..., alias='date_tp', description='날짜구분 — n일전 (1일 ~ 99일 날짜입력)')
    thema_nm: str | None = Field(None, alias='thema_nm', description='테마명 — 검색하려는 테마명')
    flu_pl_amt_tp: str = Field(..., alias='flu_pl_amt_tp', description='등락수익구분 — 1:상위기간수익률, 2:하위기간수익률, 3:상위등락률, 4:하위등락률')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90001ResponseThemaGrpItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    thema_grp_cd: str | None = Field(None, alias='thema_grp_cd', description='테마그룹코드')
    thema_nm: str | None = Field(None, alias='thema_nm', description='테마명')
    stk_num: str | None = Field(None, alias='stk_num', description='종목수')
    flu_sig: str | None = Field(None, alias='flu_sig', description='등락기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    rising_stk_num: str | None = Field(None, alias='rising_stk_num', description='상승종목수')
    fall_stk_num: str | None = Field(None, alias='fall_stk_num', description='하락종목수')
    dt_prft_rt: str | None = Field(None, alias='dt_prft_rt', description='기간수익률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    main_stk: str | None = Field(None, alias='main_stk', description='주요종목')


class Ka90001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90001'
    thema_grp: list[Ka90001ResponseThemaGrpItem] = Field(default_factory=list, alias='thema_grp', description='테마그룹별')


class Ka90002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90002'
    date_tp: str | None = Field(None, alias='date_tp', description='날짜구분 — 1일 ~ 99일 날짜입력')
    thema_grp_cd: str = Field(..., alias='thema_grp_cd', description='테마그룹코드 — 테마그룹코드 번호')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90002ResponseThemaCompStkItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    flu_sig: str | None = Field(None, alias='flu_sig', description='등락기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    sel_bid: str | None = Field(None, alias='sel_bid', description='매도호가 — 단위: 원, 부호가 포함된 숫자')
    sel_req: str | None = Field(None, alias='sel_req', description='매도잔량 — 단위: 1주')
    buy_bid: str | None = Field(None, alias='buy_bid', description='매수호가 — 단위: 원, 부호가 포함된 숫자')
    buy_req: str | None = Field(None, alias='buy_req', description='매수잔량 — 단위: 1주')
    dt_prft_rt_n: str | None = Field(None, alias='dt_prft_rt_n', description='기간수익률n — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka90002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90002'
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    dt_prft_rt: str | None = Field(None, alias='dt_prft_rt', description='기간수익률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    thema_comp_stk: list[Ka90002ResponseThemaCompStkItem] = Field(default_factory=list, alias='thema_comp_stk', description='테마구성종목')


class Ka90003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90003'
    trde_upper_tp: str = Field(..., alias='trde_upper_tp', description='매매상위구분 — 1:순매도상위, 2:순매수상위')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — P00101:코스피, P10102:코스닥')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90003ResponsePrmNetprpsUpper50Item(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    rank: str | None = Field(None, alias='rank', description='순위')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    flu_sig: str | None = Field(None, alias='flu_sig', description='등락기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    acc_trde_qty: str | None = Field(None, alias='acc_trde_qty', description='누적거래량 — 단위: 1주')
    prm_sell_amt: str | None = Field(None, alias='prm_sell_amt', description='프로그램매도금액 — 단위: 백만원')
    prm_buy_amt: str | None = Field(None, alias='prm_buy_amt', description='프로그램매수금액 — 단위: 백만원')
    prm_netprps_amt: str | None = Field(None, alias='prm_netprps_amt', description='프로그램순매수금액 — 단위: 백만원')


class Ka90003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90003'
    prm_netprps_upper_50: list[Ka90003ResponsePrmNetprpsUpper50Item] = Field(default_factory=list, alias='prm_netprps_upper_50', description='프로그램순매수상위50')


class Ka90004Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90004'
    dt: str = Field(..., alias='dt', description='일자 — YYYYMMDD')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — P00101:코스피, P10102:코스닥')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90004ResponseStkPrmTrdePrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    flu_sig: str | None = Field(None, alias='flu_sig', description='등락기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    buy_cntr_qty: str | None = Field(None, alias='buy_cntr_qty', description='매수체결수량 — 단위: 1000주')
    buy_cntr_amt: str | None = Field(None, alias='buy_cntr_amt', description='매수체결금액 — 단위: 백만원')
    sel_cntr_qty: str | None = Field(None, alias='sel_cntr_qty', description='매도체결수량 — 단위: 1000주')
    sel_cntr_amt: str | None = Field(None, alias='sel_cntr_amt', description='매도체결금액 — 단위: 백만원')
    netprps_prica: str | None = Field(None, alias='netprps_prica', description='순매수대금 — 단위: 백만원')
    all_trde_rt: str | None = Field(None, alias='all_trde_rt', description='전체거래비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka90004Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90004'
    tot_1: str | None = Field(None, alias='tot_1', description='매수체결수량합계 — 단위: 1000주, 매수체결수량합계')
    tot_2: str | None = Field(None, alias='tot_2', description='매수체결금액합계 — 단위: 백만원, 매수체결금액합계')
    tot_3: str | None = Field(None, alias='tot_3', description='매도체결수량합계 — 단위: 1000주, 매도체결수량합계')
    tot_4: str | None = Field(None, alias='tot_4', description='매도체결금액합계 — 단위: 백만원, 매도체결금액합계')
    tot_5: str | None = Field(None, alias='tot_5', description='순매수대금합계 — 단위: 백만원, 순매수대금합계')
    tot_6: str | None = Field(None, alias='tot_6', description='합계6')
    stk_prm_trde_prst: list[Ka90004ResponseStkPrmTrdePrstItem] = Field(default_factory=list, alias='stk_prm_trde_prst', description='종목별프로그램매매현황')


class Ka90005Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90005'
    date: str = Field(..., alias='date', description='날짜 — YYYYMMDD')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액(백만원), 2:수량(천주)')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 코스피- 거래소구분값 1일경우:P00101, 2일경우:P001_NX01, 3일경우:P001_AL01\n코스닥- 거래소구분값 1일경우:P10102, 2일경우:P101_NX02, 3일경우:P101_AL02')
    min_tic_tp: str = Field(..., alias='min_tic_tp', description='분틱구분 — 0:틱, 1:분')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90005ResponsePrmTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HHmmss')
    dfrt_trde_sel: str | None = Field(None, alias='dfrt_trde_sel', description='차익거래매도 — 단위: 백만원')
    dfrt_trde_buy: str | None = Field(None, alias='dfrt_trde_buy', description='차익거래매수 — 단위: 백만원')
    dfrt_trde_netprps: str | None = Field(None, alias='dfrt_trde_netprps', description='차익거래순매수 — 단위: 백만원, 부호가 포함된 숫자')
    ndiffpro_trde_sel: str | None = Field(None, alias='ndiffpro_trde_sel', description='비차익거래매도 — 단위: 백만원')
    ndiffpro_trde_buy: str | None = Field(None, alias='ndiffpro_trde_buy', description='비차익거래매수 — 단위: 백만원')
    ndiffpro_trde_netprps: str | None = Field(None, alias='ndiffpro_trde_netprps', description='비차익거래순매수 — 단위: 백만원, 부호가 포함된 숫자')
    dfrt_trde_sell_qty: str | None = Field(None, alias='dfrt_trde_sell_qty', description='차익거래매도수량 — 단위: 1000주')
    dfrt_trde_buy_qty: str | None = Field(None, alias='dfrt_trde_buy_qty', description='차익거래매수수량 — 단위: 1000주')
    dfrt_trde_netprps_qty: str | None = Field(None, alias='dfrt_trde_netprps_qty', description='차익거래순매수수량 — 단위: 1000주, 부호가 포함된 숫자')
    ndiffpro_trde_sell_qty: str | None = Field(None, alias='ndiffpro_trde_sell_qty', description='비차익거래매도수량 — 단위: 1000주')
    ndiffpro_trde_buy_qty: str | None = Field(None, alias='ndiffpro_trde_buy_qty', description='비차익거래매수수량 — 단위: 1000주')
    ndiffpro_trde_netprps_qty: str | None = Field(None, alias='ndiffpro_trde_netprps_qty', description='비차익거래순매수수량 — 단위: 1000주, 부호가 포함된 숫자')
    all_sel: str | None = Field(None, alias='all_sel', description='전체매도 — 단위: 백만원')
    all_buy: str | None = Field(None, alias='all_buy', description='전체매수 — 단위: 백만원')
    all_netprps: str | None = Field(None, alias='all_netprps', description='전체순매수 — 단위: 백만원, 부호가 포함된 숫자')
    kospi200: str | None = Field(None, alias='kospi200', description='KOSPI200 — 부호가 포함된 숫자')
    basis: str | None = Field(None, alias='basis', description='BASIS — 소수점 둘째 자리까지 포맷된 숫자')


class Ka90005Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90005'
    prm_trde_trnsn: list[Ka90005ResponsePrmTrdeTrnsnItem] = Field(default_factory=list, alias='prm_trde_trnsn', description='프로그램매매추이')


class Ka90006Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90006'
    date: str = Field(..., alias='date', description='날짜 — YYYYMMDD')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90006ResponsePrmTrdeDfrtRemnTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    buy_dfrt_trde_qty: str | None = Field(None, alias='buy_dfrt_trde_qty', description='매수차익거래수량 — 단위: 1000주')
    buy_dfrt_trde_amt: str | None = Field(None, alias='buy_dfrt_trde_amt', description='매수차익거래금액 — 단위: 백만원')
    buy_dfrt_trde_irds_amt: str | None = Field(None, alias='buy_dfrt_trde_irds_amt', description='매수차익거래증감액 — 단위: 백만원, 부호가 포함된 숫자')
    sel_dfrt_trde_qty: str | None = Field(None, alias='sel_dfrt_trde_qty', description='매도차익거래수량 — 단위: 1000주')
    sel_dfrt_trde_amt: str | None = Field(None, alias='sel_dfrt_trde_amt', description='매도차익거래금액 — 단위: 백만원')
    sel_dfrt_trde_irds_amt: str | None = Field(None, alias='sel_dfrt_trde_irds_amt', description='매도차익거래증감액 — 단위: 백만원, 부호가 포함된 숫자')


class Ka90006Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90006'
    prm_trde_dfrt_remn_trnsn: list[Ka90006ResponsePrmTrdeDfrtRemnTrnsnItem] = Field(default_factory=list, alias='prm_trde_dfrt_remn_trnsn', description='프로그램매매차익잔고추이')


class Ka90007Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90007'
    date: str = Field(..., alias='date', description='날짜 — YYYYMMDD (종료일기준 1년간 데이터만 조회가능)')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:코스피 , 1:코스닥')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka90007ResponsePrmTrdeAccTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    kospi200: str | None = Field(None, alias='kospi200', description='KOSPI200 — 부호가 포함된 숫자')
    basis: str | None = Field(None, alias='basis', description='BASIS — 소수점 둘째 자리까지 포맷된 숫자')
    dfrt_trde_tdy: str | None = Field(None, alias='dfrt_trde_tdy', description='차익거래당일 — 단위: 백만원 혹은 1000주, 부호가 포함된 숫자')
    dfrt_trde_acc: str | None = Field(None, alias='dfrt_trde_acc', description='차익거래누적 — 단위: 백만원 혹은 1000주, 부호가 포함된 숫자')
    ndiffpro_trde_tdy: str | None = Field(None, alias='ndiffpro_trde_tdy', description='비차익거래당일 — 단위: 백만원 혹은 1000주, 부호가 포함된 숫자')
    ndiffpro_trde_acc: str | None = Field(None, alias='ndiffpro_trde_acc', description='비차익거래누적 — 단위: 백만원 혹은 1000주, 부호가 포함된 숫자')
    all_tdy: str | None = Field(None, alias='all_tdy', description='전체당일 — 단위: 백만원 혹은 1000주, 부호가 포함된 숫자')
    all_acc: str | None = Field(None, alias='all_acc', description='전체누적 — 단위: 백만원 혹은 1000주, 부호가 포함된 숫자')


class Ka90007Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90007'
    prm_trde_acc_trnsn: list[Ka90007ResponsePrmTrdeAccTrnsnItem] = Field(default_factory=list, alias='prm_trde_acc_trnsn', description='프로그램매매누적추이')


class Ka90008Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90008'
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    date: str = Field(..., alias='date', description='날짜 — YYYYMMDD')


class Ka90008ResponseStkTmPrmTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    prm_sell_amt: str | None = Field(None, alias='prm_sell_amt', description='프로그램매도금액 — 단위: 백만원')
    prm_buy_amt: str | None = Field(None, alias='prm_buy_amt', description='프로그램매수금액 — 단위: 백만원')
    prm_netprps_amt: str | None = Field(None, alias='prm_netprps_amt', description='프로그램순매수금액 — 단위: 백만원, 부호가 포함된 숫자')
    prm_netprps_amt_irds: str | None = Field(None, alias='prm_netprps_amt_irds', description='프로그램순매수금액증감 — 단위: 백만원, 부호가 포함된 숫자')
    prm_sell_qty: str | None = Field(None, alias='prm_sell_qty', description='프로그램매도수량 — 단위: 1주')
    prm_buy_qty: str | None = Field(None, alias='prm_buy_qty', description='프로그램매수수량 — 단위: 1주')
    prm_netprps_qty: str | None = Field(None, alias='prm_netprps_qty', description='프로그램순매수수량 — 단위: 1주, 부호가 포함된 숫자')
    prm_netprps_qty_irds: str | None = Field(None, alias='prm_netprps_qty_irds', description='프로그램순매수수량증감 — 단위: 1주, 부호가 포함된 숫자')
    base_pric_tm: str | None = Field(None, alias='base_pric_tm', description='기준가시간 — HHmmss')
    dbrt_trde_rpy_sum: str | None = Field(None, alias='dbrt_trde_rpy_sum', description='대차거래상환주수합')
    remn_rcvord_sum: str | None = Field(None, alias='remn_rcvord_sum', description='잔고수주합')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — KRX , NXT , 통합')


class Ka90008Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90008'
    stk_tm_prm_trde_trnsn: list[Ka90008ResponseStkTmPrmTrdeTrnsnItem] = Field(default_factory=list, alias='stk_tm_prm_trde_trnsn', description='종목시간별프로그램매매추이')


class Ka90009Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90009'
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 000:전체, 001:코스피, 101:코스닥')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액(천만), 2:수량(천)')
    qry_dt_tp: str = Field(..., alias='qry_dt_tp', description='조회일자구분 — 0:조회일자 미포함, 1:조회일자 포함')
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD\n(연도4자리, 월 2자리, 일 2자리 형식)')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT, 3:통합')


class Ka90009ResponseFrgnrOrgnTrdeUpperItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    for_netslmt_stk_cd: str | None = Field(None, alias='for_netslmt_stk_cd', description='외인순매도종목코드')
    for_netslmt_stk_nm: str | None = Field(None, alias='for_netslmt_stk_nm', description='외인순매도종목명')
    for_netslmt_amt: str | None = Field(None, alias='for_netslmt_amt', description='외인순매도금액 — 단위: 억원, 부호가 포함된 숫자')
    for_netslmt_qty: str | None = Field(None, alias='for_netslmt_qty', description='외인순매도수량 — 단위: 10000주(만주), 부호가 포함된 숫자')
    for_netprps_stk_cd: str | None = Field(None, alias='for_netprps_stk_cd', description='외인순매수종목코드')
    for_netprps_stk_nm: str | None = Field(None, alias='for_netprps_stk_nm', description='외인순매수종목명')
    for_netprps_amt: str | None = Field(None, alias='for_netprps_amt', description='외인순매수금액 — 단위: 억원, 부호가 포함된 숫자')
    for_netprps_qty: str | None = Field(None, alias='for_netprps_qty', description='외인순매수수량 — 단위: 10000주(만주), 부호가 포함된 숫자')
    orgn_netslmt_stk_cd: str | None = Field(None, alias='orgn_netslmt_stk_cd', description='기관순매도종목코드')
    orgn_netslmt_stk_nm: str | None = Field(None, alias='orgn_netslmt_stk_nm', description='기관순매도종목명')
    orgn_netslmt_amt: str | None = Field(None, alias='orgn_netslmt_amt', description='기관순매도금액 — 단위: 억원, 부호가 포함된 숫자')
    orgn_netslmt_qty: str | None = Field(None, alias='orgn_netslmt_qty', description='기관순매도수량 — 단위: 10000주(만주), 부호가 포함된 숫자')
    orgn_netprps_stk_cd: str | None = Field(None, alias='orgn_netprps_stk_cd', description='기관순매수종목코드')
    orgn_netprps_stk_nm: str | None = Field(None, alias='orgn_netprps_stk_nm', description='기관순매수종목명')
    orgn_netprps_amt: str | None = Field(None, alias='orgn_netprps_amt', description='기관순매수금액 — 단위: 억원, 부호가 포함된 숫자')
    orgn_netprps_qty: str | None = Field(None, alias='orgn_netprps_qty', description='기관순매수수량 — 단위: 10000주(만주), 부호가 포함된 숫자')


class Ka90009Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90009'
    frgnr_orgn_trde_upper: list[Ka90009ResponseFrgnrOrgnTrdeUpperItem] = Field(default_factory=list, alias='frgnr_orgn_trde_upper', description='외국인기관매매상위')


class Ka90010Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90010'
    date: str = Field(..., alias='date', description='날짜 — YYYYMMDD')
    amt_qty_tp: str = Field(..., alias='amt_qty_tp', description='금액수량구분 — 1:금액(백만원), 2:수량(천주)')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 코스피- 거래소구분값 1일경우:P00101, 2일경우:P001_NX01, 3일경우:P001_AL01\n코스닥- 거래소구분값 1일경우:P10102, 2일경우:P101_NX02, 3일경우:P001_AL02')
    min_tic_tp: str = Field(..., alias='min_tic_tp', description='분틱구분 — 0:틱, 1:분')
    stex_tp: str = Field(..., alias='stex_tp', description='거래소구분 — 1:KRX, 2:NXT 3.통합')


class Ka90010ResponsePrmTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — YYYYMMDDHHmmss')
    dfrt_trde_sel: str | None = Field(None, alias='dfrt_trde_sel', description='차익거래매도 — 단위: 백만원')
    dfrt_trde_buy: str | None = Field(None, alias='dfrt_trde_buy', description='차익거래매수 — 단위: 백만원')
    dfrt_trde_netprps: str | None = Field(None, alias='dfrt_trde_netprps', description='차익거래순매수 — 단위: 백만원, 부호가 포함된 숫자')
    ndiffpro_trde_sel: str | None = Field(None, alias='ndiffpro_trde_sel', description='비차익거래매도 — 단위: 백만원')
    ndiffpro_trde_buy: str | None = Field(None, alias='ndiffpro_trde_buy', description='비차익거래매수 — 단위: 백만원')
    ndiffpro_trde_netprps: str | None = Field(None, alias='ndiffpro_trde_netprps', description='비차익거래순매수 — 단위: 백만원, 부호가 포함된 숫자')
    dfrt_trde_sell_qty: str | None = Field(None, alias='dfrt_trde_sell_qty', description='차익거래매도수량 — 단위: 1000주')
    dfrt_trde_buy_qty: str | None = Field(None, alias='dfrt_trde_buy_qty', description='차익거래매수수량 — 단위: 1000주')
    dfrt_trde_netprps_qty: str | None = Field(None, alias='dfrt_trde_netprps_qty', description='차익거래순매수수량 — 단위: 1000주, 부호가 포함된 숫자')
    ndiffpro_trde_sell_qty: str | None = Field(None, alias='ndiffpro_trde_sell_qty', description='비차익거래매도수량 — 단위: 1000주')
    ndiffpro_trde_buy_qty: str | None = Field(None, alias='ndiffpro_trde_buy_qty', description='비차익거래매수수량 — 단위: 1000주')
    ndiffpro_trde_netprps_qty: str | None = Field(None, alias='ndiffpro_trde_netprps_qty', description='비차익거래순매수수량 — 단위: 1000주, 부호가 포함된 숫자')
    all_sel: str | None = Field(None, alias='all_sel', description='전체매도 — 단위: 백만원')
    all_buy: str | None = Field(None, alias='all_buy', description='전체매수 — 단위: 백만원')
    all_netprps: str | None = Field(None, alias='all_netprps', description='전체순매수 — 단위: 백만원, 부호가 포함된 숫자')
    kospi200: str | None = Field(None, alias='kospi200', description='KOSPI200 — 부호 포함 소수점 둘째 자리까지 포맷된 숫자')
    basis: str | None = Field(None, alias='basis', description='BASIS — 소수점 둘째 자리까지 포맷된 숫자')


class Ka90010Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90010'
    prm_trde_trnsn: list[Ka90010ResponsePrmTrdeTrnsnItem] = Field(default_factory=list, alias='prm_trde_trnsn', description='프로그램매매추이')


class Ka90012Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90012'
    dt: str = Field(..., alias='dt', description='일자 — YYYYMMDD')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 001:코스피, 101:코스닥')


class Ka90012ResponseDbrtTrdePrpsItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    dbrt_trde_cntrcnt: str | None = Field(None, alias='dbrt_trde_cntrcnt', description='대차거래체결주수 — 단위: 1주')
    dbrt_trde_rpy: str | None = Field(None, alias='dbrt_trde_rpy', description='대차거래상환주수 — 단위: 1주')
    rmnd: str | None = Field(None, alias='rmnd', description='잔고주수 — 단위: 1주')
    remn_amt: str | None = Field(None, alias='remn_amt', description='잔고금액 — 단위: 백만원')


class Ka90012Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90012'
    dbrt_trde_prps: list[Ka90012ResponseDbrtTrdePrpsItem] = Field(default_factory=list, alias='dbrt_trde_prps', description='대차거래내역')


class Ka90013Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'ka90013'
    amt_qty_tp: str | None = Field(None, alias='amt_qty_tp', description='금액수량구분 — 1:금액, 2:수량')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 거래소별 종목코드\n(KRX:039490,NXT:039490_NX,SOR:039490_AL)')
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD')


class Ka90013ResponseStkDalyPrmTrdeTrnsnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    prm_sell_amt: str | None = Field(None, alias='prm_sell_amt', description='프로그램매도금액 — 단위: 백만원')
    prm_buy_amt: str | None = Field(None, alias='prm_buy_amt', description='프로그램매수금액 — 단위: 백만원')
    prm_netprps_amt: str | None = Field(None, alias='prm_netprps_amt', description='프로그램순매수금액 — 단위: 백만원, 부호가 포함된 숫자')
    prm_netprps_amt_irds: str | None = Field(None, alias='prm_netprps_amt_irds', description='프로그램순매수금액증감 — 단위: 백만원, 부호가 포함된 숫자')
    prm_sell_qty: str | None = Field(None, alias='prm_sell_qty', description='프로그램매도수량 — 단위: 1주')
    prm_buy_qty: str | None = Field(None, alias='prm_buy_qty', description='프로그램매수수량 — 단위: 1주')
    prm_netprps_qty: str | None = Field(None, alias='prm_netprps_qty', description='프로그램순매수수량 — 단위: 1주, 부호가 포함된 숫자')
    prm_netprps_qty_irds: str | None = Field(None, alias='prm_netprps_qty_irds', description='프로그램순매수수량증감 — 단위: 1주, 부호가 포함된 숫자')
    base_pric_tm: str | None = Field(None, alias='base_pric_tm', description='기준가시간 — HHmmss')
    dbrt_trde_rpy_sum: str | None = Field(None, alias='dbrt_trde_rpy_sum', description='대차거래상환주수합')
    remn_rcvord_sum: str | None = Field(None, alias='remn_rcvord_sum', description='잔고수주합')
    stex_tp: str | None = Field(None, alias='stex_tp', description='거래소구분 — KRX , NXT , 통합')


class Ka90013Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka90013'
    stk_daly_prm_trde_trnsn: list[Ka90013ResponseStkDalyPrmTrdeTrnsnItem] = Field(default_factory=list, alias='stk_daly_prm_trde_trnsn', description='종목일별프로그램매매추이')


class Kt00001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00001'
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 3:추정조회, 2:일반조회')


class Kt00001ResponseStkEntrPrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    crnc_cd: str | None = Field(None, alias='crnc_cd', description='통화코드 — 통화코드 3자리')
    fx_entr: str | None = Field(None, alias='fx_entr', description='외화예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_krw_repl_evlta: str | None = Field(None, alias='fc_krw_repl_evlta', description='원화대용평가금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_trst_profa: str | None = Field(None, alias='fc_trst_profa', description='해외주식증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pymn_alow_amt_entr: str | None = Field(None, alias='pymn_alow_amt_entr', description='출금가능금액(예수금) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pymn_alow_amt: str | None = Field(None, alias='pymn_alow_amt', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ord_alow_amt_entr: str | None = Field(None, alias='ord_alow_amt_entr', description='주문가능금액(예수금) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_uncla: str | None = Field(None, alias='fc_uncla', description='외화미수(합계) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_ch_uncla: str | None = Field(None, alias='fc_ch_uncla', description='외화현금미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    dly_amt: str | None = Field(None, alias='dly_amt', description='연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_fx_entr: str | None = Field(None, alias='d1_fx_entr', description='d+1외화예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_fx_entr: str | None = Field(None, alias='d2_fx_entr', description='d+2외화예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d3_fx_entr: str | None = Field(None, alias='d3_fx_entr', description='d+3외화예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d4_fx_entr: str | None = Field(None, alias='d4_fx_entr', description='d+4외화예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    profa_ch: str | None = Field(None, alias='profa_ch', description='주식증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    bncr_profa_ch: str | None = Field(None, alias='bncr_profa_ch', description='수익증권증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    nxdy_bncr_sell_exct: str | None = Field(None, alias='nxdy_bncr_sell_exct', description='익일수익증권매도정산대금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_stk_krw_repl_set_amt: str | None = Field(None, alias='fc_stk_krw_repl_set_amt', description='해외주식원화대용설정금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_ch: str | None = Field(None, alias='crd_grnta_ch', description='신용보증금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_ch: str | None = Field(None, alias='crd_grnt_ch', description='신용담보금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    add_grnt_ch: str | None = Field(None, alias='add_grnt_ch', description='추가담보금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_profa: str | None = Field(None, alias='etc_profa', description='기타증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    uncl_stk_amt: str | None = Field(None, alias='uncl_stk_amt', description='미수확보금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    shrts_prica: str | None = Field(None, alias='shrts_prica', description='공매도대금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_set_grnta: str | None = Field(None, alias='crd_set_grnta', description='신용설정평가금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    chck_ina_amt: str | None = Field(None, alias='chck_ina_amt', description='수표입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_chck_ina_amt: str | None = Field(None, alias='etc_chck_ina_amt', description='기타수표입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_ruse: str | None = Field(None, alias='crd_grnt_ruse', description='신용담보재사용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    knx_asset_evltv: str | None = Field(None, alias='knx_asset_evltv', description='코넥스기본예탁금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    elwdpst_evlta: str | None = Field(None, alias='elwdpst_evlta', description='ELW예탁평가금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_ls_rght_frcs_amt: str | None = Field(None, alias='crd_ls_rght_frcs_amt', description='신용대주권리예정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    lvlh_join_amt: str | None = Field(None, alias='lvlh_join_amt', description='생계형가입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    lvlh_trns_alowa: str | None = Field(None, alias='lvlh_trns_alowa', description='생계형입금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금평가금액(합계) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    remn_repl_evlta: str | None = Field(None, alias='remn_repl_evlta', description='잔고대용평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    trst_remn_repl_evlta: str | None = Field(None, alias='trst_remn_repl_evlta', description='위탁대용잔고평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    bncr_remn_repl_evlta: str | None = Field(None, alias='bncr_remn_repl_evlta', description='수익증권대용평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    profa_repl: str | None = Field(None, alias='profa_repl', description='위탁증거금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_repl: str | None = Field(None, alias='crd_grnta_repl', description='신용보증금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_repl: str | None = Field(None, alias='crd_grnt_repl', description='신용담보금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    add_grnt_repl: str | None = Field(None, alias='add_grnt_repl', description='추가담보금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    rght_repl_amt: str | None = Field(None, alias='rght_repl_amt', description='권리대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pymn_alow_amt: str | None = Field(None, alias='pymn_alow_amt', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    wrap_pymn_alow_amt: str | None = Field(None, alias='wrap_pymn_alow_amt', description='랩출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ord_alow_amt: str | None = Field(None, alias='ord_alow_amt', description='주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    bncr_buy_alowa: str | None = Field(None, alias='bncr_buy_alowa', description='수익증권매수가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_20stk_ord_alow_amt: str | None = Field(None, alias='20stk_ord_alow_amt', description='20%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_30stk_ord_alow_amt: str | None = Field(None, alias='30stk_ord_alow_amt', description='30%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_40stk_ord_alow_amt: str | None = Field(None, alias='40stk_ord_alow_amt', description='40%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_100stk_ord_alow_amt: str | None = Field(None, alias='100stk_ord_alow_amt', description='100%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_uncla: str | None = Field(None, alias='ch_uncla', description='현금미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_uncla_dlfe: str | None = Field(None, alias='ch_uncla_dlfe', description='현금미수연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_uncla_tot: str | None = Field(None, alias='ch_uncla_tot', description='현금미수금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_int_npay: str | None = Field(None, alias='crd_int_npay', description='신용이자미납 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    int_npay_amt_dlfe: str | None = Field(None, alias='int_npay_amt_dlfe', description='신용이자미납연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    int_npay_amt_tot: str | None = Field(None, alias='int_npay_amt_tot', description='신용이자미납합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loana: str | None = Field(None, alias='etc_loana', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loana_dlfe: str | None = Field(None, alias='etc_loana_dlfe', description='기타대여금연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loan_tot: str | None = Field(None, alias='etc_loan_tot', description='기타대여금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    nrpy_loan: str | None = Field(None, alias='nrpy_loan', description='미상환융자금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    loan_sum: str | None = Field(None, alias='loan_sum', description='융자금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ls_sum: str | None = Field(None, alias='ls_sum', description='대주금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_rt: str | None = Field(None, alias='crd_grnt_rt', description='신용담보비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    mdstrm_usfe: str | None = Field(None, alias='mdstrm_usfe', description='중도이용료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    min_ord_alow_yn: str | None = Field(None, alias='min_ord_alow_yn', description='최소주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    loan_remn_evlt_amt: str | None = Field(None, alias='loan_remn_evlt_amt', description='대출총평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    dpst_grntl_remn: str | None = Field(None, alias='dpst_grntl_remn', description='예탁담보대출잔고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    sell_grntl_remn: str | None = Field(None, alias='sell_grntl_remn', description='매도담보대출잔고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_entra: str | None = Field(None, alias='d1_entra', description='d+1추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_slby_exct_amt: str | None = Field(None, alias='d1_slby_exct_amt', description='d+1매도매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_buy_exct_amt: str | None = Field(None, alias='d1_buy_exct_amt', description='d+1매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_out_rep_mor: str | None = Field(None, alias='d1_out_rep_mor', description='d+1미수변제소요금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_sel_exct_amt: str | None = Field(None, alias='d1_sel_exct_amt', description='d+1매도정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_pymn_alow_amt: str | None = Field(None, alias='d1_pymn_alow_amt', description='d+1출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_entra: str | None = Field(None, alias='d2_entra', description='d+2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_slby_exct_amt: str | None = Field(None, alias='d2_slby_exct_amt', description='d+2매도매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_buy_exct_amt: str | None = Field(None, alias='d2_buy_exct_amt', description='d+2매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_out_rep_mor: str | None = Field(None, alias='d2_out_rep_mor', description='d+2미수변제소요금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_sel_exct_amt: str | None = Field(None, alias='d2_sel_exct_amt', description='d+2매도정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_pymn_alow_amt: str | None = Field(None, alias='d2_pymn_alow_amt', description='d+2출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_50stk_ord_alow_amt: str | None = Field(None, alias='50stk_ord_alow_amt', description='50%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_60stk_ord_alow_amt: str | None = Field(None, alias='60stk_ord_alow_amt', description='60%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    stk_entr_prst: list[Kt00001ResponseStkEntrPrstItem] = Field(default_factory=list, alias='stk_entr_prst', description='종목별예수금')


class Kt00002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00002'
    start_dt: str = Field(..., alias='start_dt', description='시작조회기간 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료조회기간 — YYYYMMDD')


class Kt00002ResponseDalyPrsmDpstAsetAmtPrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    dt: str | None = Field(None, alias='dt', description='일자 — YYYYMMDD')
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    grnt_use_amt: str | None = Field(None, alias='grnt_use_amt', description='담보대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan: str | None = Field(None, alias='crd_loan', description='신용융자금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_grnt: str | None = Field(None, alias='ls_grnt', description='대주담보금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    prsm_dpst_aset_amt: str | None = Field(None, alias='prsm_dpst_aset_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    prsm_dpst_aset_amt_bncr_skip: str | None = Field(None, alias='prsm_dpst_aset_amt_bncr_skip', description='추정예탁자산수익증권제외 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00002'
    daly_prsm_dpst_aset_amt_prst: list[Kt00002ResponseDalyPrsmDpstAsetAmtPrstItem] = Field(default_factory=list, alias='daly_prsm_dpst_aset_amt_prst', description='일별추정예탁자산현황')


class Kt00003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00003'
    qry_tp: str = Field(..., alias='qry_tp', description='상장폐지조회구분 — 0:전체, 1:상장폐지종목제외')


class Kt00003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00003'
    prsm_dpst_aset_amt: str | None = Field(None, alias='prsm_dpst_aset_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00004Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00004'
    qry_tp: str = Field(..., alias='qry_tp', description='상장폐지조회구분 — 0:전체, 1:상장폐지종목제외')
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX:한국거래소,NXT:넥스트트레이드')


class Kt00004ResponseStkAcntEvltPrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    rmnd_qty: str | None = Field(None, alias='rmnd_qty', description='보유수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    avg_prc: str | None = Field(None, alias='avg_prc', description='평균단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evlt_amt: str | None = Field(None, alias='evlt_amt', description='평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pl_amt: str | None = Field(None, alias='pl_amt', description='손익금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pl_rt: str | None = Field(None, alias='pl_rt', description='손익율 — 단위: %, 소수점 넷째 자리까지 포맷된 백분율')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYYMMDD')
    pur_amt: str | None = Field(None, alias='pur_amt', description='매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    setl_remn: str | None = Field(None, alias='setl_remn', description='결제잔고 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pred_buyq: str | None = Field(None, alias='pred_buyq', description='전일매수수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pred_sellq: str | None = Field(None, alias='pred_sellq', description='전일매도수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_buyq: str | None = Field(None, alias='tdy_buyq', description='금일매수수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_sellq: str | None = Field(None, alias='tdy_sellq', description='금일매도수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00004Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00004'
    acnt_nm: str | None = Field(None, alias='acnt_nm', description='계좌명')
    brch_nm: str | None = Field(None, alias='brch_nm', description='지점명')
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    d2_entra: str | None = Field(None, alias='d2_entra', description='D+2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_est_amt: str | None = Field(None, alias='tot_est_amt', description='유가잔고평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    aset_evlt_amt: str | None = Field(None, alias='aset_evlt_amt', description='예탁자산평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_pur_amt: str | None = Field(None, alias='tot_pur_amt', description='총매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    prsm_dpst_aset_amt: str | None = Field(None, alias='prsm_dpst_aset_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_grnt_sella: str | None = Field(None, alias='tot_grnt_sella', description='매도담보대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_lspft_amt: str | None = Field(None, alias='tdy_lspft_amt', description='당일투자원금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    invt_bsamt: str | None = Field(None, alias='invt_bsamt', description='당월투자원금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    lspft_amt: str | None = Field(None, alias='lspft_amt', description='누적투자원금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_lspft: str | None = Field(None, alias='tdy_lspft', description='당일투자손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    lspft2: str | None = Field(None, alias='lspft2', description='당월투자손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    lspft: str | None = Field(None, alias='lspft', description='누적투자손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_lspft_rt: str | None = Field(None, alias='tdy_lspft_rt', description='당일손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lspft_ratio: str | None = Field(None, alias='lspft_ratio', description='당월손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lspft_rt: str | None = Field(None, alias='lspft_rt', description='누적손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    stk_acnt_evlt_prst: list[Kt00004ResponseStkAcntEvltPrstItem] = Field(default_factory=list, alias='stk_acnt_evlt_prst', description='종목별계좌평가현황')


class Kt00005Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00005'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX:한국거래소,NXT:넥스트트레이드')


class Kt00005ResponseStkCntrRemnItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYMMDD')
    expr_dt: str | None = Field(None, alias='expr_dt', description='만기일 — YYYMMDD')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목번호 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    setl_remn: str | None = Field(None, alias='setl_remn', description='결제잔고 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cur_qty: str | None = Field(None, alias='cur_qty', description='현재잔고 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_uv: str | None = Field(None, alias='buy_uv', description='매입단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pur_amt: str | None = Field(None, alias='pur_amt', description='매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evlt_amt: str | None = Field(None, alias='evlt_amt', description='평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evltv_prft: str | None = Field(None, alias='evltv_prft', description='평가손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pl_rt: str | None = Field(None, alias='pl_rt', description='손익률 — 단위: %, 소수점 넷째 자리까지 포맷된 백분율')


class Kt00005Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr_d1: str | None = Field(None, alias='entr_d1', description='예수금D+1 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr_d2: str | None = Field(None, alias='entr_d2', description='예수금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pymn_alow_amt: str | None = Field(None, alias='pymn_alow_amt', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncl_stk_amt: str | None = Field(None, alias='uncl_stk_amt', description='미수확보금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rght_repl_amt: str | None = Field(None, alias='rght_repl_amt', description='권리대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ch_uncla: str | None = Field(None, alias='ch_uncla', description='현금미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold: str | None = Field(None, alias='crd_int_npay_gold', description='신용이자미납금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana: str | None = Field(None, alias='etc_loana', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    nrpy_loan: str | None = Field(None, alias='nrpy_loan', description='미상환융자금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_ch: str | None = Field(None, alias='profa_ch', description='증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_profa: str | None = Field(None, alias='repl_profa', description='증거금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    stk_buy_tot_amt: str | None = Field(None, alias='stk_buy_tot_amt', description='주식매수총액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evlt_amt_tot: str | None = Field(None, alias='evlt_amt_tot', description='평가금액합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_pl_tot: str | None = Field(None, alias='tot_pl_tot', description='총손익합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_pl_rt: str | None = Field(None, alias='tot_pl_rt', description='총손익률 — 단위: %, 소수점 넷째 자리까지 포맷된 백분율')
    tot_re_buy_alowa: str | None = Field(None, alias='tot_re_buy_alowa', description='총재매수가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_20ord_alow_amt: str | None = Field(None, alias='20ord_alow_amt', description='20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_30ord_alow_amt: str | None = Field(None, alias='30ord_alow_amt', description='30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_40ord_alow_amt: str | None = Field(None, alias='40ord_alow_amt', description='40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_50ord_alow_amt: str | None = Field(None, alias='50ord_alow_amt', description='50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_60ord_alow_amt: str | None = Field(None, alias='60ord_alow_amt', description='60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_100ord_alow_amt: str | None = Field(None, alias='100ord_alow_amt', description='100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_tot: str | None = Field(None, alias='crd_loan_tot', description='신용융자합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_ls_tot: str | None = Field(None, alias='crd_loan_ls_tot', description='신용융자대주합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_grnt_rt: str | None = Field(None, alias='crd_grnt_rt', description='신용담보비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    dpst_grnt_use_amt_amt: str | None = Field(None, alias='dpst_grnt_use_amt_amt', description='예탁담보대출금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    grnt_loan_amt: str | None = Field(None, alias='grnt_loan_amt', description='매도담보대출금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    stk_cntr_remn: list[Kt00005ResponseStkCntrRemnItem] = Field(default_factory=list, alias='stk_cntr_remn', description='종목별체결잔고')


class Kt00007Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00007'
    ord_dt: str | None = Field(None, alias='ord_dt', description='주문일자 — YYYYMMDD')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 1:주문순, 2:역순, 3:미체결, 4:체결내역만')
    stk_bond_tp: str = Field(..., alias='stk_bond_tp', description='주식채권구분 — 0:전체, 1:주식, 2:채권')
    sell_tp: str = Field(..., alias='sell_tp', description='매도수구분 — 0:전체, 1:매도, 2:매수')
    stk_cd: str | None = Field(None, alias='stk_cd', description="종목코드 — 전체 종목 조회는 빈값('')으로 설정")
    fr_ord_no: str | None = Field(None, alias='fr_ord_no', description="시작주문번호 — 시작주문번호 입력 시 이전 주문은 조회되지 않음, 전체 조회는 빈값('')으로 설정")
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — %:(전체),KRX:한국거래소,NXT:넥스트트레이드,SOR:최선주문집행')


class Kt00007ResponseAcntOrdCntrPrpsDtlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 고유 주문번호 7자리')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목번호 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cnfm_qty: str | None = Field(None, alias='cnfm_qty', description='확인수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    acpt_tp: str | None = Field(None, alias='acpt_tp', description='접수구분')
    rsrv_tp: str | None = Field(None, alias='rsrv_tp', description='반대여부')
    ord_tm: str | None = Field(None, alias='ord_tm', description='주문시간 — HH:mm:ss')
    ori_ord: str | None = Field(None, alias='ori_ord', description='원주문')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문구분')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYYMMDD')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cntr_uv: str | None = Field(None, alias='cntr_uv', description='체결단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_remnq: str | None = Field(None, alias='ord_remnq', description='주문잔량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    comm_ord_tp: str | None = Field(None, alias='comm_ord_tp', description='통신구분')
    mdfy_cncl: str | None = Field(None, alias='mdfy_cncl', description='정정취소')
    cnfm_tm: str | None = Field(None, alias='cnfm_tm', description='확인시간 — HH:mm:ss')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분')
    cond_uv: str | None = Field(None, alias='cond_uv', description='스톱가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')


class Kt00007Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00007'
    acnt_ord_cntr_prps_dtl: list[Kt00007ResponseAcntOrdCntrPrpsDtlItem] = Field(default_factory=list, alias='acnt_ord_cntr_prps_dtl', description='계좌별주문체결내역상세')


class Kt00008Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00008'
    strt_dcd_seq: str | None = Field(None, alias='strt_dcd_seq', description='시작결제번호')


class Kt00008ResponseAcntNxdySetlFrcsPrpsArrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    seq: str | None = Field(None, alias='seq', description='일련번호 — 7자리 숫자')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목번호 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일')
    qty: str | None = Field(None, alias='qty', description='수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    engg_amt: str | None = Field(None, alias='engg_amt', description='약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    incm_tax: str | None = Field(None, alias='incm_tax', description='소득세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rstx: str | None = Field(None, alias='rstx', description='농특세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    sell_tp: str | None = Field(None, alias='sell_tp', description='매도수구분')
    unp: str | None = Field(None, alias='unp', description='단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    exct_amt: str | None = Field(None, alias='exct_amt', description='정산금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    trde_tax: str | None = Field(None, alias='trde_tax', description='거래세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    resi_tax: str | None = Field(None, alias='resi_tax', description='주민세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')


class Kt00008Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00008'
    trde_dt: str | None = Field(None, alias='trde_dt', description='매매일자 — YYYYMMDD')
    setl_dt: str | None = Field(None, alias='setl_dt', description='결제일자 — YYYYMMDD')
    sell_amt_sum: str | None = Field(None, alias='sell_amt_sum', description='매도정산합 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_amt_sum: str | None = Field(None, alias='buy_amt_sum', description='매수정산합 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    acnt_nxdy_setl_frcs_prps_array: list[Kt00008ResponseAcntNxdySetlFrcsPrpsArrayItem] = Field(default_factory=list, alias='acnt_nxdy_setl_frcs_prps_array', description='계좌별익일결제예정내역배열')


class Kt00009Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00009'
    ord_dt: str | None = Field(None, alias='ord_dt', description='주문일자 — YYYYMMDD')
    stk_bond_tp: str = Field(..., alias='stk_bond_tp', description='주식채권구분 — 0:전체, 1:주식, 2:채권')
    mrkt_tp: str = Field(..., alias='mrkt_tp', description='시장구분 — 0:전체, 1:코스피, 2:코스닥, 3:OTCBB, 4:ECN')
    sell_tp: str = Field(..., alias='sell_tp', description='매도수구분 — 0:전체, 1:매도, 2:매수')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 0:전체, 1:체결')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 전문 조회할 종목코드')
    fr_ord_no: str | None = Field(None, alias='fr_ord_no', description='시작주문번호 — 시작주문번호의 이전 주문은 조회 되지 않으며 약정금액에도 포함 되지 않음')
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — %:(전체),KRX:한국거래소,NXT:넥스트트레이드,SOR:최선주문집행')


class Kt00009ResponseAcntOrdCntrPrstArrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_bond_tp: str | None = Field(None, alias='stk_bond_tp', description='주식채권구분')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 고유 주문번호 7자리')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목번호 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문유형구분')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cnfm_qty: str | None = Field(None, alias='cnfm_qty', description='확인수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    rsrv_oppo: str | None = Field(None, alias='rsrv_oppo', description='예약/반대')
    cntr_no: str | None = Field(None, alias='cntr_no', description='체결번호 — 체결번호 7자리')
    acpt_tp: str | None = Field(None, alias='acpt_tp', description='접수구분')
    orig_ord_no: str | None = Field(None, alias='orig_ord_no', description="원주문번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    setl_tp: str | None = Field(None, alias='setl_tp', description='결제구분')
    crd_deal_tp: str | None = Field(None, alias='crd_deal_tp', description='신용거래구분')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cntr_uv: str | None = Field(None, alias='cntr_uv', description='체결단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    comm_ord_tp: str | None = Field(None, alias='comm_ord_tp', description='통신구분')
    mdfy_cncl_tp: str | None = Field(None, alias='mdfy_cncl_tp', description='정정/취소구분')
    cntr_tm: str | None = Field(None, alias='cntr_tm', description='체결시간 — HH:mm:ss')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분')
    cond_uv: str | None = Field(None, alias='cond_uv', description='스톱가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')


class Kt00009Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00009'
    sell_grntl_engg_amt: str | None = Field(None, alias='sell_grntl_engg_amt', description='매도약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_engg_amt: str | None = Field(None, alias='buy_engg_amt', description='매수약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    engg_amt: str | None = Field(None, alias='engg_amt', description='약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    acnt_ord_cntr_prst_array: list[Kt00009ResponseAcntOrdCntrPrstArrayItem] = Field(default_factory=list, alias='acnt_ord_cntr_prst_array', description='계좌별주문체결현황배열')


class Kt00010Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00010'
    io_amt: str | None = Field(None, alias='io_amt', description='입출금액 — 단위: 원')
    stk_cd: str = Field(..., alias='stk_cd', description='종목번호 — 종목 코드 입력')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 1:매도, 2:매수')
    trde_qty: str | None = Field(None, alias='trde_qty', description='매매수량 — 단위: 1주')
    uv: str = Field(..., alias='uv', description='매수가격 — 단위: 원')
    exp_buy_unp: str | None = Field(None, alias='exp_buy_unp', description='예상매수단가 — 단위: 원')


class Kt00010Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00010'
    profa_20ord_alow_amt: str | None = Field(None, alias='profa_20ord_alow_amt', description='증거금20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20ord_alowq: str | None = Field(None, alias='profa_20ord_alowq', description='증거금20%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_30ord_alow_amt: str | None = Field(None, alias='profa_30ord_alow_amt', description='증거금30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30ord_alowq: str | None = Field(None, alias='profa_30ord_alowq', description='증거금30%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_40ord_alow_amt: str | None = Field(None, alias='profa_40ord_alow_amt', description='증거금40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40ord_alowq: str | None = Field(None, alias='profa_40ord_alowq', description='증거금40%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_50ord_alow_amt: str | None = Field(None, alias='profa_50ord_alow_amt', description='증거금50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50ord_alowq: str | None = Field(None, alias='profa_50ord_alowq', description='증거금50%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_60ord_alow_amt: str | None = Field(None, alias='profa_60ord_alow_amt', description='증거금60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60ord_alowq: str | None = Field(None, alias='profa_60ord_alowq', description='증거금60%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_rdex_60ord_alow_amt: str | None = Field(None, alias='profa_rdex_60ord_alow_amt', description='증거금감면60%주문가능금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_rdex_60ord_alowq: str | None = Field(None, alias='profa_rdex_60ord_alowq', description='증거금감면60%주문가능수 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_100ord_alow_amt: str | None = Field(None, alias='profa_100ord_alow_amt', description='증거금100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100ord_alowq: str | None = Field(None, alias='profa_100ord_alowq', description='증거금100%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    pred_reu_alowa: str | None = Field(None, alias='pred_reu_alowa', description='전일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_reu_alowa: str | None = Field(None, alias='tdy_reu_alowa', description='금일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_pos_repl: str | None = Field(None, alias='ord_pos_repl', description='주문가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    wthd_alowa: str | None = Field(None, alias='wthd_alowa', description='인출가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    nxdy_wthd_alowa: str | None = Field(None, alias='nxdy_wthd_alowa', description='익일인출가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pur_amt: str | None = Field(None, alias='pur_amt', description='매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pur_exct_amt: str | None = Field(None, alias='pur_exct_amt', description='매입정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    d2entra: str | None = Field(None, alias='d2entra', description='D2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_rdex_aplc_tp: str | None = Field(None, alias='profa_rdex_aplc_tp', description='증거금감면적용구분 — 0:일반,1:60%감면')


class Kt00011Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00011'
    stk_cd: str = Field(..., alias='stk_cd', description='종목번호 — 종목 코드 입력')
    uv: str | None = Field(None, alias='uv', description='매수가격 — 단위: 원')


class Kt00011Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00011'
    stk_profa_rt: str | None = Field(None, alias='stk_profa_rt', description='종목증거금율 — %가 포함된 백분율 값')
    profa_rt: str | None = Field(None, alias='profa_rt', description='계좌증거금율 — %가 포함된 백분율 값')
    aplc_rt: str | None = Field(None, alias='aplc_rt', description='적용증거금율 — %가 포함된 백분율 값')
    profa_20ord_alow_amt: str | None = Field(None, alias='profa_20ord_alow_amt', description='증거금20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20ord_alowq: str | None = Field(None, alias='profa_20ord_alowq', description='증거금20%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20pred_reu_amt: str | None = Field(None, alias='profa_20pred_reu_amt', description='증거금20%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20tdy_reu_amt: str | None = Field(None, alias='profa_20tdy_reu_amt', description='증거금20%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30ord_alow_amt: str | None = Field(None, alias='profa_30ord_alow_amt', description='증거금30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30ord_alowq: str | None = Field(None, alias='profa_30ord_alowq', description='증거금30%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30pred_reu_amt: str | None = Field(None, alias='profa_30pred_reu_amt', description='증거금30%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30tdy_reu_amt: str | None = Field(None, alias='profa_30tdy_reu_amt', description='증거금30%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40ord_alow_amt: str | None = Field(None, alias='profa_40ord_alow_amt', description='증거금40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40ord_alowq: str | None = Field(None, alias='profa_40ord_alowq', description='증거금40%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40pred_reu_amt: str | None = Field(None, alias='profa_40pred_reu_amt', description='증거금40전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40tdy_reu_amt: str | None = Field(None, alias='profa_40tdy_reu_amt', description='증거금40%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50ord_alow_amt: str | None = Field(None, alias='profa_50ord_alow_amt', description='증거금50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50ord_alowq: str | None = Field(None, alias='profa_50ord_alowq', description='증거금50%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50pred_reu_amt: str | None = Field(None, alias='profa_50pred_reu_amt', description='증거금50%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50tdy_reu_amt: str | None = Field(None, alias='profa_50tdy_reu_amt', description='증거금50%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60ord_alow_amt: str | None = Field(None, alias='profa_60ord_alow_amt', description='증거금60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60ord_alowq: str | None = Field(None, alias='profa_60ord_alowq', description='증거금60%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60pred_reu_amt: str | None = Field(None, alias='profa_60pred_reu_amt', description='증거금60%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60tdy_reu_amt: str | None = Field(None, alias='profa_60tdy_reu_amt', description='증거금60%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100ord_alow_amt: str | None = Field(None, alias='profa_100ord_alow_amt', description='증거금100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100ord_alowq: str | None = Field(None, alias='profa_100ord_alowq', description='증거금100%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100pred_reu_amt: str | None = Field(None, alias='profa_100pred_reu_amt', description='증거금100%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100tdy_reu_amt: str | None = Field(None, alias='profa_100tdy_reu_amt', description='증거금100%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_ord_alow_amt: str | None = Field(None, alias='min_ord_alow_amt', description='미수불가주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_ord_alowq: str | None = Field(None, alias='min_ord_alowq', description='미수불가주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_pred_reu_amt: str | None = Field(None, alias='min_pred_reu_amt', description='미수불가전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_tdy_reu_amt: str | None = Field(None, alias='min_tdy_reu_amt', description='미수불가금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_pos_repl: str | None = Field(None, alias='ord_pos_repl', description='주문가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00012Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00012'
    stk_cd: str = Field(..., alias='stk_cd', description='종목번호 — 종목 코드 입력')
    uv: str | None = Field(None, alias='uv', description='매수가격 — 단위: 원')


class Kt00012Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00012'
    stk_assr_rt: str | None = Field(None, alias='stk_assr_rt', description='종목보증금율')
    stk_assr_rt_nm: str | None = Field(None, alias='stk_assr_rt_nm', description='종목보증금율명')
    assr_30ord_alow_amt: str | None = Field(None, alias='assr_30ord_alow_amt', description='보증금30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_30ord_alowq: str | None = Field(None, alias='assr_30ord_alowq', description='보증금30%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_30pred_reu_amt: str | None = Field(None, alias='assr_30pred_reu_amt', description='보증금30%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_30tdy_reu_amt: str | None = Field(None, alias='assr_30tdy_reu_amt', description='보증금30%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40ord_alow_amt: str | None = Field(None, alias='assr_40ord_alow_amt', description='보증금40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40ord_alowq: str | None = Field(None, alias='assr_40ord_alowq', description='보증금40%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40pred_reu_amt: str | None = Field(None, alias='assr_40pred_reu_amt', description='보증금40%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40tdy_reu_amt: str | None = Field(None, alias='assr_40tdy_reu_amt', description='보증금40%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50ord_alow_amt: str | None = Field(None, alias='assr_50ord_alow_amt', description='보증금50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50ord_alowq: str | None = Field(None, alias='assr_50ord_alowq', description='보증금50%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50pred_reu_amt: str | None = Field(None, alias='assr_50pred_reu_amt', description='보증금50%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50tdy_reu_amt: str | None = Field(None, alias='assr_50tdy_reu_amt', description='보증금50%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60ord_alow_amt: str | None = Field(None, alias='assr_60ord_alow_amt', description='보증금60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60ord_alowq: str | None = Field(None, alias='assr_60ord_alowq', description='보증금60%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60pred_reu_amt: str | None = Field(None, alias='assr_60pred_reu_amt', description='보증금60%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60tdy_reu_amt: str | None = Field(None, alias='assr_60tdy_reu_amt', description='보증금60%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_pos_repl: str | None = Field(None, alias='ord_pos_repl', description='주문가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    out_alowa: str | None = Field(None, alias='out_alowa', description='미수가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    out_pos_qty: str | None = Field(None, alias='out_pos_qty', description='미수가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_amt: str | None = Field(None, alias='min_amt', description='미수불가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_qty: str | None = Field(None, alias='min_qty', description='미수불가수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00013Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00013'


class Kt00013Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    tdy_reu_objt_amt: str | None = Field(None, alias='tdy_reu_objt_amt', description='금일재사용대상금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_use_amt: str | None = Field(None, alias='tdy_reu_use_amt', description='금일재사용사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_alowa: str | None = Field(None, alias='tdy_reu_alowa', description='금일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_lmtt_amt: str | None = Field(None, alias='tdy_reu_lmtt_amt', description='금일재사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_alowa_fin: str | None = Field(None, alias='tdy_reu_alowa_fin', description='금일재사용가능금액최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_objt_amt: str | None = Field(None, alias='pred_reu_objt_amt', description='전일재사용대상금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_use_amt: str | None = Field(None, alias='pred_reu_use_amt', description='전일재사용사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_alowa: str | None = Field(None, alias='pred_reu_alowa', description='전일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_lmtt_amt: str | None = Field(None, alias='pred_reu_lmtt_amt', description='전일재사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_alowa_fin: str | None = Field(None, alias='pred_reu_alowa_fin', description='전일재사용가능금액최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_amt: str | None = Field(None, alias='ch_amt', description='현금금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_profa: str | None = Field(None, alias='ch_profa', description='현금증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_ch: str | None = Field(None, alias='use_pos_ch', description='사용가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_use_lmtt_amt: str | None = Field(None, alias='ch_use_lmtt_amt', description='현금사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_ch_fin: str | None = Field(None, alias='use_pos_ch_fin', description='사용가능현금최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_amt_amt: str | None = Field(None, alias='repl_amt_amt', description='대용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_profa: str | None = Field(None, alias='repl_profa', description='대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_repl: str | None = Field(None, alias='use_pos_repl', description='사용가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_use_lmtt_amt: str | None = Field(None, alias='repl_use_lmtt_amt', description='대용사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_repl_fin: str | None = Field(None, alias='use_pos_repl_fin', description='사용가능대용최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_ch: str | None = Field(None, alias='crd_grnta_ch', description='신용보증금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_repl: str | None = Field(None, alias='crd_grnta_repl', description='신용보증금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_ch: str | None = Field(None, alias='crd_grnt_ch', description='신용담보금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_repl: str | None = Field(None, alias='crd_grnt_repl', description='신용담보금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ls_grnt_reu_gold: str | None = Field(None, alias='ls_grnt_reu_gold', description='대주담보금재사용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_20ord_alow_amt: str | None = Field(None, alias='20ord_alow_amt', description='20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_30ord_alow_amt: str | None = Field(None, alias='30ord_alow_amt', description='30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_40ord_alow_amt: str | None = Field(None, alias='40ord_alow_amt', description='40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_50ord_alow_amt: str | None = Field(None, alias='50ord_alow_amt', description='50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_60ord_alow_amt: str | None = Field(None, alias='60ord_alow_amt', description='60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_100ord_alow_amt: str | None = Field(None, alias='100ord_alow_amt', description='100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_crd_rpya_loss_amt: str | None = Field(None, alias='tdy_crd_rpya_loss_amt', description='금일신용상환손실금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_crd_rpya_loss_amt: str | None = Field(None, alias='pred_crd_rpya_loss_amt', description='전일신용상환손실금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_ls_rpya_loss_repl_profa: str | None = Field(None, alias='tdy_ls_rpya_loss_repl_profa', description='금일대주상환손실대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_ls_rpya_loss_repl_profa: str | None = Field(None, alias='pred_ls_rpya_loss_repl_profa', description='전일대주상환손실대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    evlt_repl_amt_spg_use_skip: str | None = Field(None, alias='evlt_repl_amt_spg_use_skip', description='평가대용금(현물사용제외) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    evlt_repl_rt: str | None = Field(None, alias='evlt_repl_rt', description='평가대용비율 — 단위: %, 소수점 일곱번째 자리까지 포맷된 백분율')
    crd_repl_profa: str | None = Field(None, alias='crd_repl_profa', description='신용대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_ord_repl_profa: str | None = Field(None, alias='ch_ord_repl_profa', description='현금주문대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_ord_repl_profa: str | None = Field(None, alias='crd_ord_repl_profa', description='신용주문대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_repl_conv_gold: str | None = Field(None, alias='crd_repl_conv_gold', description='신용대용환산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_alowa: str | None = Field(None, alias='repl_alowa', description='대용가능금액(현금제한) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_alowa_2: str | None = Field(None, alias='repl_alowa_2', description='대용가능금액2(신용제한) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_repl_lck_gold: str | None = Field(None, alias='ch_repl_lck_gold', description='현금대용부족금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_repl_lck_gold: str | None = Field(None, alias='crd_repl_lck_gold', description='신용대용부족금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_ord_alow_repla: str | None = Field(None, alias='ch_ord_alow_repla', description='현금주문가능대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_ord_alow_repla: str | None = Field(None, alias='crd_ord_alow_repla', description='신용주문가능대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2vexct_entr: str | None = Field(None, alias='d2vexct_entr', description='D2가정산예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2ch_ord_alow_amt: str | None = Field(None, alias='d2ch_ord_alow_amt', description='D2현금주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00015Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00015'
    strt_dt: str = Field(..., alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str = Field(..., alias='end_dt', description='종료일자 — YYYYMMDD')
    tp: str = Field(..., alias='tp', description='구분 — 0:전체,1:입출금,2:입출고,3:매매,4:매수,5:매도,6:입금,7:출금,A:예탁담보대출입금,B:매도담보대출입금,C:현금상환(융자,담보상환),F:환전,M:입출금+환전,G:외화매수,H:외화매도,I:환전정산입금,J:환전정산출금')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목 코드 입력')
    crnc_cd: str | None = Field(None, alias='crnc_cd', description='통화코드 — 통화코드 3자리')
    gds_tp: str = Field(..., alias='gds_tp', description='상품구분 — 0:전체, 1:국내주식, 2:수익증권, 3:해외주식, 4:금융상품')
    frgn_stex_code: str | None = Field(None, alias='frgn_stex_code', description='해외거래소코드')
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — %:(전체),KRX:한국거래소,NXT:넥스트트레이드')
    qry_sort_tp: str | None = Field(None, alias='qry_sort_tp', description='조회정렬구분 — 1:최근거래순, 2:과거거래순(미입력시 과거거래순)')


class Kt00015ResponseTrstOvrlTrdePrpsArrayItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    trde_dt: str | None = Field(None, alias='trde_dt', description='거래일자 — YYYYMMDD')
    trde_no: str | None = Field(None, alias='trde_no', description='거래번호 — 거래번호 9자리')
    rmrk_nm: str | None = Field(None, alias='rmrk_nm', description='적요명')
    crd_deal_tp_nm: str | None = Field(None, alias='crd_deal_tp_nm', description='신용거래구분명')
    exct_amt: str | None = Field(None, alias='exct_amt', description='정산금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    loan_amt_rpya: str | None = Field(None, alias='loan_amt_rpya', description='대출금상환 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_trde_amt: str | None = Field(None, alias='fc_trde_amt', description='거래금액(외)')
    fc_exct_amt: str | None = Field(None, alias='fc_exct_amt', description='정산금액(외)')
    entra_remn: str | None = Field(None, alias='entra_remn', description='예수금잔고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crnc_cd: str | None = Field(None, alias='crnc_cd', description='통화코드')
    trde_ocr_tp: str | None = Field(None, alias='trde_ocr_tp', description='거래종류구분 — 1:입출금, 2:펀드, 3:ELS, 4:채권, 5:해외채권, 6:외화RP, 7:외화발행어음')
    trde_kind_nm: str | None = Field(None, alias='trde_kind_nm', description='거래종류명 — 거래종류구분자(trde_ocr_tp)의 한글명')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    trde_amt: str | None = Field(None, alias='trde_amt', description='거래금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    trde_agri_tax: str | None = Field(None, alias='trde_agri_tax', description='거래및농특세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    rpy_diffa: str | None = Field(None, alias='rpy_diffa', description='상환차금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_trde_tax: str | None = Field(None, alias='fc_trde_tax', description='거래세(외)')
    dly_sum: str | None = Field(None, alias='dly_sum', description='연체합 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_entra: str | None = Field(None, alias='fc_entra', description='외화예수금잔고')
    mdia_tp_nm: str | None = Field(None, alias='mdia_tp_nm', description='매체구분명')
    io_tp: str | None = Field(None, alias='io_tp', description='입출구분')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='입출구분명')
    orig_deal_no: str | None = Field(None, alias='orig_deal_no', description="원거래번호 — 원 거래가 없는 경우 '000000000'으로 출력")
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    trde_qty_jwa_cnt: str | None = Field(None, alias='trde_qty_jwa_cnt', description='거래수량/좌수')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    int_ls_usfe: str | None = Field(None, alias='int_ls_usfe', description='이자/대주이용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_cmsn: str | None = Field(None, alias='fc_cmsn', description='수수료(외)')
    fc_dly_sum: str | None = Field(None, alias='fc_dly_sum', description='연체합(외)')
    vlbl_nowrm: str | None = Field(None, alias='vlbl_nowrm', description='유가금잔')
    proc_tm: str | None = Field(None, alias='proc_tm', description='처리시간 — HH:mm:ss')
    isin_cd: str | None = Field(None, alias='isin_cd', description='ISIN코드')
    stex_cd: str | None = Field(None, alias='stex_cd', description='거래소코드')
    stex_nm: str | None = Field(None, alias='stex_nm', description='거래소명')
    trde_unit: str | None = Field(None, alias='trde_unit', description='거래단가/환율')
    incm_resi_tax: str | None = Field(None, alias='incm_resi_tax', description='소득/주민세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYYMMDD')
    uncl_ocr: str | None = Field(None, alias='uncl_ocr', description='미수(원/주)')
    rpym_sum: str | None = Field(None, alias='rpym_sum', description='변제합')
    cntr_dt: str | None = Field(None, alias='cntr_dt', description='체결일 — YYYYMMDD')
    rcpy_no: str | None = Field(None, alias='rcpy_no', description='출납번호')
    prcsr: str | None = Field(None, alias='prcsr', description='처리자')
    proc_brch: str | None = Field(None, alias='proc_brch', description='처리점')
    trde_stle: str | None = Field(None, alias='trde_stle', description='매매형태')
    txon_base_pric: str | None = Field(None, alias='txon_base_pric', description='과세기준가')
    tax_sum_cmsn: str | None = Field(None, alias='tax_sum_cmsn', description='세금수수료합')
    frgn_pay_txam: str | None = Field(None, alias='frgn_pay_txam', description='외국납부세액(외)')
    fc_uncl_ocr: str | None = Field(None, alias='fc_uncl_ocr', description='미수(외)')
    rpym_sum_fr: str | None = Field(None, alias='rpym_sum_fr', description='변제합(외)')
    rcpmnyer: str | None = Field(None, alias='rcpmnyer', description='입금자')
    trde_prtc_tp: str | None = Field(None, alias='trde_prtc_tp', description='거래내역구분')


class Kt00015Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00015'
    trst_ovrl_trde_prps_array: list[Kt00015ResponseTrstOvrlTrdePrpsArrayItem] = Field(default_factory=list, alias='trst_ovrl_trde_prps_array', description='위탁종합거래내역배열')


class Kt00016Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00016'
    fr_dt: str = Field(..., alias='fr_dt', description='평가시작일 — YYYYMMDD')
    to_dt: str = Field(..., alias='to_dt', description='평가종료일 — YYYYMMDD')


class Kt00016Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00016'
    mang_empno: str | None = Field(None, alias='mang_empno', description='관리사원번호')
    mngr_nm: str | None = Field(None, alias='mngr_nm', description='관리자명')
    dept_nm: str | None = Field(None, alias='dept_nm', description='관리자지점')
    entr_fr: str | None = Field(None, alias='entr_fr', description='예수금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr_to: str | None = Field(None, alias='entr_to', description='예수금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    scrt_evlt_amt_fr: str | None = Field(None, alias='scrt_evlt_amt_fr', description='유가증권평가금액_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    scrt_evlt_amt_to: str | None = Field(None, alias='scrt_evlt_amt_to', description='유가증권평가금액_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_grnt_fr: str | None = Field(None, alias='ls_grnt_fr', description='대주담보금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_grnt_to: str | None = Field(None, alias='ls_grnt_to', description='대주담보금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_fr: str | None = Field(None, alias='crd_loan_fr', description='신용융자금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_to: str | None = Field(None, alias='crd_loan_to', description='신용융자금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ch_uncla_fr: str | None = Field(None, alias='ch_uncla_fr', description='현금미수금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ch_uncla_to: str | None = Field(None, alias='ch_uncla_to', description='현금미수금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    krw_asgna_fr: str | None = Field(None, alias='krw_asgna_fr', description='원화대용금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    krw_asgna_to: str | None = Field(None, alias='krw_asgna_to', description='원화대용금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_evlta_fr: str | None = Field(None, alias='ls_evlta_fr', description='대주평가금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_evlta_to: str | None = Field(None, alias='ls_evlta_to', description='대주평가금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rght_evlta_fr: str | None = Field(None, alias='rght_evlta_fr', description='권리평가금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rght_evlta_to: str | None = Field(None, alias='rght_evlta_to', description='권리평가금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    loan_amt_fr: str | None = Field(None, alias='loan_amt_fr', description='대출금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    loan_amt_to: str | None = Field(None, alias='loan_amt_to', description='대출금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana_fr: str | None = Field(None, alias='etc_loana_fr', description='기타대여금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana_to: str | None = Field(None, alias='etc_loana_to', description='기타대여금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold_fr: str | None = Field(None, alias='crd_int_npay_gold_fr', description='신용이자미납금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold_to: str | None = Field(None, alias='crd_int_npay_gold_to', description='신용이자미납금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_fr: str | None = Field(None, alias='crd_int_fr', description='신용이자_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_to: str | None = Field(None, alias='crd_int_to', description='신용이자_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_amt_fr: str | None = Field(None, alias='tot_amt_fr', description='순자산액계_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_amt_to: str | None = Field(None, alias='tot_amt_to', description='순자산액계_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    invt_bsamt: str | None = Field(None, alias='invt_bsamt', description='투자원금평잔 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evltv_prft: str | None = Field(None, alias='evltv_prft', description='평가손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    prft_rt: str | None = Field(None, alias='prft_rt', description='수익률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    tern_rt: str | None = Field(None, alias='tern_rt', description='회전율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    termin_tot_trns: str | None = Field(None, alias='termin_tot_trns', description='기간내총입금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    termin_tot_pymn: str | None = Field(None, alias='termin_tot_pymn', description='기간내총출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    termin_tot_inq: str | None = Field(None, alias='termin_tot_inq', description='기간내총입고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    termin_tot_outq: str | None = Field(None, alias='termin_tot_outq', description='기간내총출고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    futr_repl_sella: str | None = Field(None, alias='futr_repl_sella', description='선물대용매도금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    trst_repl_sella: str | None = Field(None, alias='trst_repl_sella', description='위탁대용매도금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00017Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00017'


class Kt00017Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00017'
    d2_entra: str | None = Field(None, alias='d2_entra', description='D+2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold: str | None = Field(None, alias='crd_int_npay_gold', description='신용이자미납금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana: str | None = Field(None, alias='etc_loana', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    gnrl_stk_evlt_amt_d2: str | None = Field(None, alias='gnrl_stk_evlt_amt_d2', description='일반주식평가금액D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    dpst_grnt_use_amt_d2: str | None = Field(None, alias='dpst_grnt_use_amt_d2', description='예탁담보대출금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_stk_evlt_amt_d2: str | None = Field(None, alias='crd_stk_evlt_amt_d2', description='예탁담보주식평가금액D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_d2: str | None = Field(None, alias='crd_loan_d2', description='신용융자금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_evlta_d2: str | None = Field(None, alias='crd_loan_evlta_d2', description='신용융자평가금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_ls_grnt_d2: str | None = Field(None, alias='crd_ls_grnt_d2', description='신용대주담보금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_ls_evlta_d2: str | None = Field(None, alias='crd_ls_evlta_d2', description='신용대주평가금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ina_amt: str | None = Field(None, alias='ina_amt', description='입금금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    outa: str | None = Field(None, alias='outa', description='출금금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    inq_amt: str | None = Field(None, alias='inq_amt', description='입고금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    outq_amt: str | None = Field(None, alias='outq_amt', description='출고금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    sell_amt: str | None = Field(None, alias='sell_amt', description='매도금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_amt: str | None = Field(None, alias='buy_amt', description='매수금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tax: str | None = Field(None, alias='tax', description='세금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    stk_pur_cptal_loan_amt: str | None = Field(None, alias='stk_pur_cptal_loan_amt', description='주식매입자금대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rp_evlt_amt: str | None = Field(None, alias='rp_evlt_amt', description='RP평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    bd_evlt_amt: str | None = Field(None, alias='bd_evlt_amt', description='채권평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    elsevlt_amt: str | None = Field(None, alias='elsevlt_amt', description='ELS평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_amt: str | None = Field(None, alias='crd_int_amt', description='신용이자금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    sel_prica_grnt_loan_int_amt_amt: str | None = Field(None, alias='sel_prica_grnt_loan_int_amt_amt', description='매도대금담보대출이자금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    dvida_amt: str | None = Field(None, alias='dvida_amt', description='배당금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00018Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt00018'
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 1:합산, 2:개별')
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX:한국거래소,NXT:넥스트트레이드')


class Kt00018ResponseAcntEvltRemnIndvTotItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목번호 — 접두어 1자리 + 종목코드 6자리, 접두어(A: 주식 / J: ELW / Q: ETN)')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    evltv_prft: str | None = Field(None, alias='evltv_prft', description='평가손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    prft_rt: str | None = Field(None, alias='prft_rt', description='수익률(%) — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    pur_pric: str | None = Field(None, alias='pur_pric', description='매입가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_close_pric: str | None = Field(None, alias='pred_close_pric', description='전일종가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rmnd_qty: str | None = Field(None, alias='rmnd_qty', description='보유수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    trde_able_qty: str | None = Field(None, alias='trde_able_qty', description='매매가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pred_buyq: str | None = Field(None, alias='pred_buyq', description='전일매수수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_sellq: str | None = Field(None, alias='pred_sellq', description='전일매도수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_buyq: str | None = Field(None, alias='tdy_buyq', description='금일매수수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_sellq: str | None = Field(None, alias='tdy_sellq', description='금일매도수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pur_amt: str | None = Field(None, alias='pur_amt', description='매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pur_cmsn: str | None = Field(None, alias='pur_cmsn', description='매입수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    evlt_amt: str | None = Field(None, alias='evlt_amt', description='평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    sell_cmsn: str | None = Field(None, alias='sell_cmsn', description='평가수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tax: str | None = Field(None, alias='tax', description='세금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    sum_cmsn: str | None = Field(None, alias='sum_cmsn', description='수수료합 — 매입수수료 + 평가수수료')
    poss_rt: str | None = Field(None, alias='poss_rt', description='보유비중(%) — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')
    crd_tp_nm: str | None = Field(None, alias='crd_tp_nm', description='신용구분명')
    crd_loan_dt: str | None = Field(None, alias='crd_loan_dt', description='대출일 — YYYYMMDD')


class Kt00018Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00018'
    tot_pur_amt: str | None = Field(None, alias='tot_pur_amt', description='총매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_evlt_amt: str | None = Field(None, alias='tot_evlt_amt', description='총평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_evlt_pl: str | None = Field(None, alias='tot_evlt_pl', description='총평가손익금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_prft_rt: str | None = Field(None, alias='tot_prft_rt', description='총수익률(%) — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    prsm_dpst_aset_amt: str | None = Field(None, alias='prsm_dpst_aset_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_loan_amt: str | None = Field(None, alias='tot_loan_amt', description='총대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_crd_loan_amt: str | None = Field(None, alias='tot_crd_loan_amt', description='총융자금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_crd_ls_amt: str | None = Field(None, alias='tot_crd_ls_amt', description='총대주금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    acnt_evlt_remn_indv_tot: list[Kt00018ResponseAcntEvltRemnIndvTotItem] = Field(default_factory=list, alias='acnt_evlt_remn_indv_tot', description='계좌평가잔고개별합산')


class Kt10000Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10000'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    ord_qty: str = Field(..., alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:보통 , 3:시장가 , 5:조건부지정가 , 81:장마감후시간외 , 61:장시작전시간외, 62:시간외단일가 , 6:최유리지정가 , 7:최우선지정가 , 10:보통(IOC) , 13:시장가(IOC) , 16:최유리(IOC) , 20:보통(FOK) , 23:시장가(FOK) , 26:최유리(FOK) , 28:스톱지정가,29:중간가,30:중간가(IOC),31:중간가(FOK)')
    cond_uv: str | None = Field(None, alias='cond_uv', description='조건단가 — 단위: 원')


class Kt10000Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10000'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 7자리 주문번호')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — KRX, NXT, SOR')


class Kt10001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10001'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    ord_qty: str = Field(..., alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:보통 , 3:시장가 , 5:조건부지정가 , 81:장마감후시간외 , 61:장시작전시간외, 62:시간외단일가 , 6:최유리지정가 , 7:최우선지정가 , 10:보통(IOC) , 13:시장가(IOC) , 16:최유리(IOC) , 20:보통(FOK) , 23:시장가(FOK) , 26:최유리(FOK) , 28:스톱지정가,29:중간가,30:중간가(IOC),31:중간가(FOK)')
    cond_uv: str | None = Field(None, alias='cond_uv', description='조건단가 — 단위: 원')


class Kt10001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10001'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 7자리 주문번호')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — KRX, NXT, SOR')


class Kt10002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10002'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    orig_ord_no: str = Field(..., alias='orig_ord_no', description='원주문번호 — 매수/매도 주문 요청 응답 결과로 받은 7자리 주문번호')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    mdfy_qty: str = Field(..., alias='mdfy_qty', description="정정수량 — 단위: 1주, '0' 입력 시 잔량 전부 정정")
    mdfy_uv: str = Field(..., alias='mdfy_uv', description='정정단가 — 단위: 원')
    mdfy_cond_uv: str | None = Field(None, alias='mdfy_cond_uv', description='정정조건단가 — 단위: 원')


class Kt10002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10002'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 새 주문번호')
    base_orig_ord_no: str | None = Field(None, alias='base_orig_ord_no', description='모주문번호 — 원 주문번호')
    mdfy_qty: str | None = Field(None, alias='mdfy_qty', description='정정수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — KRX, NXT, SOR')


class Kt10003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10003'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    orig_ord_no: str = Field(..., alias='orig_ord_no', description='원주문번호 — 매수/매도 주문 요청 응답 결과로 받은 7자리 주문번호')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    cncl_qty: str = Field(..., alias='cncl_qty', description="취소수량 — 단위: 1주, '0' 입력시 잔량 전부 취소")


class Kt10003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10003'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 새 주문번호')
    base_orig_ord_no: str | None = Field(None, alias='base_orig_ord_no', description='모주문번호 — 원 주문번호')
    cncl_qty: str | None = Field(None, alias='cncl_qty', description='취소수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt10006Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10006'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    ord_qty: str = Field(..., alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:보통 , 3:시장가 , 5:조건부지정가 , 81:장마감후시간외 , 61:장시작전시간외, 62:시간외단일가 , 6:최유리지정가 , 7:최우선지정가 , 10:보통(IOC) , 13:시장가(IOC) , 16:최유리(IOC) , 20:보통(FOK) , 23:시장가(FOK) , 26:최유리(FOK) , 28:스톱지정가,29:중간가,30:중간가(IOC),31:중간가(FOK)')
    cond_uv: str | None = Field(None, alias='cond_uv', description='조건단가 — 단위: 원')


class Kt10006Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10006'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 7자리 주문번호')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — KRX, NXT, SOR')


class Kt10007Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10007'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    ord_qty: str = Field(..., alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 0:보통 , 3:시장가 , 5:조건부지정가 , 81:장마감후시간외 , 61:장시작전시간외, 62:시간외단일가 , 6:최유리지정가 , 7:최우선지정가 , 10:보통(IOC) , 13:시장가(IOC) , 16:최유리(IOC) , 20:보통(FOK) , 23:시장가(FOK) , 26:최유리(FOK) , 28:스톱지정가,29:중간가,30:중간가(IOC),31:중간가(FOK)')
    crd_deal_tp: str = Field(..., alias='crd_deal_tp', description='신용거래구분 — 33:융자 , 99:융자합')
    crd_loan_dt: str | None = Field(None, alias='crd_loan_dt', description='대출일 — YYYYMMDD(융자일경우필수)')
    cond_uv: str | None = Field(None, alias='cond_uv', description='조건단가 — 단위: 원')


class Kt10007Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10007'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 7자리 주문번호')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — KRX, NXT, SOR')


class Kt10008Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10008'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    orig_ord_no: str = Field(..., alias='orig_ord_no', description='원주문번호 — 매수/매도 주문 요청 응답 결과로 받은 7자리 주문번호')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    mdfy_qty: str = Field(..., alias='mdfy_qty', description="정정수량 — 단위: 1주, '0' 입력시 잔량 전부 정정")
    mdfy_uv: str = Field(..., alias='mdfy_uv', description='정정단가 — 단위: 원')
    mdfy_cond_uv: str | None = Field(None, alias='mdfy_cond_uv', description='정정조건단가 — 단위: 원')


class Kt10008Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10008'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 새 주문번호')
    base_orig_ord_no: str | None = Field(None, alias='base_orig_ord_no', description='모주문번호 — 원 주문번호')
    mdfy_qty: str | None = Field(None, alias='mdfy_qty', description='정정수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — KRX, NXT, SOR')


class Kt10009Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt10009'
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — KRX,NXT,SOR')
    orig_ord_no: str = Field(..., alias='orig_ord_no', description='원주문번호 — 매수/매도 주문 요청 응답 결과로 받은 7자리 주문번호')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드')
    cncl_qty: str = Field(..., alias='cncl_qty', description="취소수량 — 단위: 1주, '0' 입력시 잔량 전부 취소")


class Kt10009Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt10009'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 새 주문번호')
    base_orig_ord_no: str | None = Field(None, alias='base_orig_ord_no', description='모주문번호 — 원 주문번호')
    cncl_qty: str | None = Field(None, alias='cncl_qty', description='취소수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt20016Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt20016'
    crd_stk_grde_tp: str | None = Field(None, alias='crd_stk_grde_tp', description='신용종목등급구분 — %:전체, A:A군, B:B군, C:C군, D:D군, E:E군')
    mrkt_deal_tp: str = Field(..., alias='mrkt_deal_tp', description='시장거래구분 — %:전체, 1:코스피, 0:코스닥')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 종목 코드 입력')


class Kt20016ResponseCrdLoanPosStkItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    crd_assr_rt: str | None = Field(None, alias='crd_assr_rt', description='신용보증금율 — %가 포함된 백분율')
    repl_pric: str | None = Field(None, alias='repl_pric', description='대용가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pred_close_pric: str | None = Field(None, alias='pred_close_pric', description='전일종가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_limit_over_yn: str | None = Field(None, alias='crd_limit_over_yn', description='신용한도초과여부 — Y, N')
    crd_limit_over_txt: str | None = Field(None, alias='crd_limit_over_txt', description='신용한도초과 — N:공란,Y:회사한도 초과')


class Kt20016Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt20016'
    crd_loan_able: str | None = Field(None, alias='crd_loan_able', description='신용융자가능여부')
    crd_loan_pos_stk: list[Kt20016ResponseCrdLoanPosStkItem] = Field(default_factory=list, alias='crd_loan_pos_stk', description='신용융자가능종목')


class Kt20017Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt20017'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — 종목 코드 입력')


class Kt20017Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt20017'
    crd_alow_yn: str | None = Field(None, alias='crd_alow_yn', description='신용가능여부')


class Kt50000Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50000'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    ord_qty: str = Field(..., alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 00:보통, 10:보통(IOC), 20:보통(FOK)')


class Kt50000Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50000'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 7자리 주문번호')


class Kt50001Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50001'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    ord_qty: str = Field(..., alias='ord_qty', description='주문수량 — 단위: 1주')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원')
    trde_tp: str = Field(..., alias='trde_tp', description='매매구분 — 00:보통, 10:보통(IOC), 20:보통(FOK)')


class Kt50001Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50001'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 7자리 주문번호')


class Kt50002Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50002'
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    orig_ord_no: str = Field(..., alias='orig_ord_no', description='원주문번호')
    mdfy_qty: str = Field(..., alias='mdfy_qty', description="정정수량 — 단위: 1주, '0' 입력시 잔량 전부 정정")
    mdfy_uv: str = Field(..., alias='mdfy_uv', description='정정단가 — 단위: 원')


class Kt50002Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50002'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 새 주문번호')
    base_orig_ord_no: str | None = Field(None, alias='base_orig_ord_no', description='모주문번호 — 원 주문번호')
    mdfy_qty: str | None = Field(None, alias='mdfy_qty', description='정정수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt50003Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50003'
    orig_ord_no: str = Field(..., alias='orig_ord_no', description='원주문번호 — 매수/매도 주문 요청 응답 결과로 받은 7자리 주문번호')
    stk_cd: str = Field(..., alias='stk_cd', description='종목코드 — M04020000 금 99.99_1kg, M04020100 미니금 99.99_100g')
    cncl_qty: str = Field(..., alias='cncl_qty', description="취소수량 — 단위: 1주, '0' 입력시 잔량 전부 취소")


class Kt50003Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50003'
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 새 주문번호')
    base_orig_ord_no: str | None = Field(None, alias='base_orig_ord_no', description='모주문번호 — 원 주문번호')
    cncl_qty: str | None = Field(None, alias='cncl_qty', description='취소수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt50020Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50020'


class Kt50020ResponseGoldAcntEvltPrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 금 종목 코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명 — 금 종목 코드 설명')
    real_qty: str | None = Field(None, alias='real_qty', description='보유수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    avg_prc: str | None = Field(None, alias='avg_prc', description='평균단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    est_amt: str | None = Field(None, alias='est_amt', description='평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    est_lspft: str | None = Field(None, alias='est_lspft', description='손익금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    est_ratio: str | None = Field(None, alias='est_ratio', description='손익율 — 단위: %, 소수점 넷째 자리까지 포맷된 백분율')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    vlad_tax: str | None = Field(None, alias='vlad_tax', description='부가가치세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    book_amt2: str | None = Field(None, alias='book_amt2', description='매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pl_prch_prc: str | None = Field(None, alias='pl_prch_prc', description='손익분기매입가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    qty: str | None = Field(None, alias='qty', description='결제잔고 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_qty: str | None = Field(None, alias='buy_qty', description='매수수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    sell_qty: str | None = Field(None, alias='sell_qty', description='매도수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    able_qty: str | None = Field(None, alias='able_qty', description='가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt50020Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50020'
    tot_entr: str | None = Field(None, alias='tot_entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    net_entr: str | None = Field(None, alias='net_entr', description='추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_est_amt: str | None = Field(None, alias='tot_est_amt', description='잔고평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    net_amt: str | None = Field(None, alias='net_amt', description='예탁자산평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_book_amt2: str | None = Field(None, alias='tot_book_amt2', description='총매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_dep_amt: str | None = Field(None, alias='tot_dep_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    paym_alowa: str | None = Field(None, alias='paym_alowa', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pl_amt: str | None = Field(None, alias='pl_amt', description='실현손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    gold_acnt_evlt_prst: list[Kt50020ResponseGoldAcntEvltPrstItem] = Field(default_factory=list, alias='gold_acnt_evlt_prst', description='금현물계좌평가현황')


class Kt50021Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50021'


class Kt50021Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50021'
    entra: str | None = Field(None, alias='entra', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    profa_ch: str | None = Field(None, alias='profa_ch', description='증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    chck_ina_amt: str | None = Field(None, alias='chck_ina_amt', description='수표입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loan: str | None = Field(None, alias='etc_loan', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loan_dlfe: str | None = Field(None, alias='etc_loan_dlfe', description='기타대여금연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loan_tot: str | None = Field(None, alias='etc_loan_tot', description='기타대여금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    prsm_entra: str | None = Field(None, alias='prsm_entra', description='추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    buy_exct_amt: str | None = Field(None, alias='buy_exct_amt', description='매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    sell_exct_amt: str | None = Field(None, alias='sell_exct_amt', description='매도정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    sell_buy_exct_amt: str | None = Field(None, alias='sell_buy_exct_amt', description='매도매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    dly_amt: str | None = Field(None, alias='dly_amt', description='미수변제소요금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    prsm_pymn_alow_amt: str | None = Field(None, alias='prsm_pymn_alow_amt', description='추정출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pymn_alow_amt: str | None = Field(None, alias='pymn_alow_amt', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ord_alow_amt: str | None = Field(None, alias='ord_alow_amt', description='주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt50030Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50030'
    ord_dt: str = Field(..., alias='ord_dt', description='주문일자 — YYYYMMDD')
    qry_tp: str | None = Field(None, alias='qry_tp', description='조회구분 — 1: 주문순, 2: 역순')
    mrkt_deal_tp: str = Field(..., alias='mrkt_deal_tp', description='시장구분 — 5:KRX금현물, 5값으로 고정')
    stk_bond_tp: str = Field(..., alias='stk_bond_tp', description='주식채권구분 — 0:전체, 1:주식, 2:채권')
    slby_tp: str = Field(..., alias='slby_tp', description='매도수구분 — 0:전체, 1:매도, 2:매수')
    stk_cd: str | None = Field(None, alias='stk_cd', description="종목코드 — M04020000: 금 99.99_1kg, M04020100: 미니금 99.99_100g, 전체 조회는 빈값('')으로 설정")
    fr_ord_no: str | None = Field(None, alias='fr_ord_no', description="시작주문번호 — 시작주문번호 입력 시 이전 주문은 조회되지 않음, 전체 조회는 빈값('')으로 설정")
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — %:(전체), KRX, NXT, SOR')


class Kt50030ResponseAcntOrdCntrPrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_bond_tp: str | None = Field(None, alias='stk_bond_tp', description='주식채권구분')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 주문번호 7자리')
    stk_cd: str | None = Field(None, alias='stk_cd', description='상품코드 — 금 종목코드 9자리')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문유형구분')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cnfm_qty: str | None = Field(None, alias='cnfm_qty', description='확인수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    data_send_end_tp: str | None = Field(None, alias='data_send_end_tp', description='접수구분')
    mrkt_deal_tp: str | None = Field(None, alias='mrkt_deal_tp', description='시장구분')
    rsrv_tp: str | None = Field(None, alias='rsrv_tp', description='예약/반대여부')
    orig_ord_no: str | None = Field(None, alias='orig_ord_no', description="원주문번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    dcd_tp_nm: str | None = Field(None, alias='dcd_tp_nm', description='결제구분')
    crd_deal_tp: str | None = Field(None, alias='crd_deal_tp', description='신용거래구분')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cntr_uv: str | None = Field(None, alias='cntr_uv', description='체결단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_remnq: str | None = Field(None, alias='ord_remnq', description='미체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    comm_ord_tp: str | None = Field(None, alias='comm_ord_tp', description='통신구분')
    mdfy_cncl_tp: str | None = Field(None, alias='mdfy_cncl_tp', description='정정취소구분')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분')
    cond_uv: str | None = Field(None, alias='cond_uv', description='스톱가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')


class Kt50030Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50030'
    acnt_ord_cntr_prst: list[Kt50030ResponseAcntOrdCntrPrstItem] = Field(default_factory=list, alias='acnt_ord_cntr_prst', description='계좌별주문체결현황')


class Kt50031Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50031'
    ord_dt: str | None = Field(None, alias='ord_dt', description='주문일자 — YYYYMMDD')
    qry_tp: str = Field(..., alias='qry_tp', description='조회구분 — 1:주문순, 2:역순, 3:미체결, 4:체결내역만')
    stk_bond_tp: str = Field(..., alias='stk_bond_tp', description='주식채권구분 — 0:전체, 1:주식, 2:채권')
    sell_tp: str = Field(..., alias='sell_tp', description='매도수구분 — 0:전체, 1:매도, 2:매수')
    stk_cd: str | None = Field(None, alias='stk_cd', description="종목코드 — M04020000: 금 99.99_1kg, M04020100: 미니금 99.99_100g, 전체 조회는 빈값('')으로 설정")
    fr_ord_no: str | None = Field(None, alias='fr_ord_no', description="시작주문번호 — 시작주문번호 입력 시 이전 주문은 조회되지 않음, 전체 조회는 빈값('')으로 설정")
    dmst_stex_tp: str = Field(..., alias='dmst_stex_tp', description='국내거래소구분 — %:(전체),KRX:한국거래소,NXT:넥스트트레이드,SOR:최선주문집행')


class Kt50031ResponseAcntOrdCntrPrpsDtlItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 주문번호 7자리')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목번호 — 금 종목코드 9자리')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    crd_tp: str | None = Field(None, alias='crd_tp', description='신용구분')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cnfm_qty: str | None = Field(None, alias='cnfm_qty', description='확인수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    acpt_tp: str | None = Field(None, alias='acpt_tp', description='접수구분')
    rsrv_tp: str | None = Field(None, alias='rsrv_tp', description='반대여부')
    ord_tm: str | None = Field(None, alias='ord_tm', description='주문시간 — HH:mm:ss')
    ori_ord: str | None = Field(None, alias='ori_ord', description="원주문 — 원 주문이 없는 경우 '0000000'으로 출력")
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문구분')
    loan_dt: str | None = Field(None, alias='loan_dt', description='대출일 — YYYYMMDD')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cntr_uv: str | None = Field(None, alias='cntr_uv', description='체결단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_remnq: str | None = Field(None, alias='ord_remnq', description='주문잔량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    comm_ord_tp: str | None = Field(None, alias='comm_ord_tp', description='통신구분')
    mdfy_cncl: str | None = Field(None, alias='mdfy_cncl', description='정정취소')
    cnfm_tm: str | None = Field(None, alias='cnfm_tm', description='확인시간 — HH:mm:ss')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분')
    cond_uv: str | None = Field(None, alias='cond_uv', description='스톱가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')


class Kt50031Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50031'
    acnt_ord_cntr_prps_dtl: list[Kt50031ResponseAcntOrdCntrPrpsDtlItem] = Field(default_factory=list, alias='acnt_ord_cntr_prps_dtl', description='계좌별주문체결내역상세')


class Kt50032Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50032'
    strt_dt: str | None = Field(None, alias='strt_dt', description='시작일자 — YYYYMMDD')
    end_dt: str | None = Field(None, alias='end_dt', description='종료일자 — YYYYMMDD')
    tp: str | None = Field(None, alias='tp', description='구분 — 0:전체, 1:입출금, 2:출고, 3:매매, 4:매수, 5:매도, 6:입금, 7:출금')
    stk_cd: str | None = Field(None, alias='stk_cd', description="종목코드 — M04020000: 금 99.99_1kg, M04020100: 미니금 99.99_100g, 전체 조회는 빈값('')으로 설정")


class Kt50032ResponseGoldTrdeHistItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    deal_dt: str | None = Field(None, alias='deal_dt', description='거래일자 — YYYYMMDD')
    deal_no: str | None = Field(None, alias='deal_no', description='거래번호 — 거래번호 9자리')
    rmrk_nm: str | None = Field(None, alias='rmrk_nm', description='적요명')
    deal_qty: str | None = Field(None, alias='deal_qty', description='거래수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    gold_spot_vat: str | None = Field(None, alias='gold_spot_vat', description='금현물부가가치세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    exct_amt: str | None = Field(None, alias='exct_amt', description='정산금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    dly_sum: str | None = Field(None, alias='dly_sum', description='연체합 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    entra_remn: str | None = Field(None, alias='entra_remn', description='예수금잔고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    mdia_nm: str | None = Field(None, alias='mdia_nm', description='메체구분명')
    orig_deal_no: str | None = Field(None, alias='orig_deal_no', description="원거래번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    uv_exrt: str | None = Field(None, alias='uv_exrt', description='거래단가')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    uncl_ocr: str | None = Field(None, alias='uncl_ocr', description='미수(원/g) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    rpym_sum: str | None = Field(None, alias='rpym_sum', description='변제합 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    spot_remn: str | None = Field(None, alias='spot_remn', description='현물잔고 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    proc_time: str | None = Field(None, alias='proc_time', description='처리시간 — HH:mm:ss')
    rcpy_no: str | None = Field(None, alias='rcpy_no', description='출납번호 — 출납번호 9자리')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드 — 금 종목 코드')
    deal_amt: str | None = Field(None, alias='deal_amt', description='거래금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tax_tot_amt: str | None = Field(None, alias='tax_tot_amt', description='소득/주민세 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    cntr_dt: str | None = Field(None, alias='cntr_dt', description='체결일 — YYYYMMDD')
    proc_brch_nm: str | None = Field(None, alias='proc_brch_nm', description='처리점')
    prcsr: str | None = Field(None, alias='prcsr', description='처리자')


class Kt50032Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50032'
    acnt_print: str | None = Field(None, alias='acnt_print', description='계좌번호 — 계좌번호 출력용')
    gold_trde_hist: list[Kt50032ResponseGoldTrdeHistItem] = Field(default_factory=list, alias='gold_trde_hist', description='금현물거래내역')


class Kt50075Request(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid')
    tr_id: ClassVar[str] = 'kt50075'
    ord_dt: str = Field(..., alias='ord_dt', description='주문일자 — YYYYMMDD')
    qry_tp: str | None = Field(None, alias='qry_tp', description='조회구분 — 1: 주문순, 2: 역순')
    mrkt_deal_tp: str = Field(..., alias='mrkt_deal_tp', description='시장구분 — 5:KRW금현물, 5값으로 고정')
    stk_bond_tp: str = Field(..., alias='stk_bond_tp', description='주식채권구분 — 0:전체, 1:주식, 2:채권')
    sell_tp: str = Field(..., alias='sell_tp', description='매도수구분 — 0:전체, 1:매도, 2:매수')
    stk_cd: str | None = Field(None, alias='stk_cd', description="종목코드 — M04020000: 금 99.99_1kg, M04020100: 미니금 99.99_100g, 전체 조회는 빈값('')으로 설정")
    fr_ord_no: str | None = Field(None, alias='fr_ord_no', description="시작주문번호 — 시작주문번호 입력 시 이전 주문은 조회되지 않음, 전체 조회는 빈값('')으로 설정")
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분 — %:(전체), KRX, NXT, SOR')


class Kt50075ResponseAcntOrdOsoPrstItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    stk_bond_tp: str | None = Field(None, alias='stk_bond_tp', description='주식채권구분')
    ord_no: str | None = Field(None, alias='ord_no', description='주문번호 — 주문번호 7자리')
    stk_cd: str | None = Field(None, alias='stk_cd', description='상품코드 — 금 종목코드 9자리')
    trde_tp: str | None = Field(None, alias='trde_tp', description='매매구분')
    io_tp_nm: str | None = Field(None, alias='io_tp_nm', description='주문유형구분')
    ord_qty: str | None = Field(None, alias='ord_qty', description='주문수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_uv: str | None = Field(None, alias='ord_uv', description='주문단가 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cnfm_qty: str | None = Field(None, alias='cnfm_qty', description='확인수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    data_send_end_tp: str | None = Field(None, alias='data_send_end_tp', description='접수구분')
    mrkt_deal_tp: str | None = Field(None, alias='mrkt_deal_tp', description='시장구분')
    rsrv_tp: str | None = Field(None, alias='rsrv_tp', description='예약/반대여부')
    orig_ord_no: str | None = Field(None, alias='orig_ord_no', description="원주문번호 — 원 주문이 없는 경우 '0000000'으로 출력")
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    dcd_tp_nm: str | None = Field(None, alias='dcd_tp_nm', description='결제구분')
    crd_deal_tp: str | None = Field(None, alias='crd_deal_tp', description='신용거래구분')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    cntr_uv: str | None = Field(None, alias='cntr_uv', description='체결단가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    ord_remnq: str | None = Field(None, alias='ord_remnq', description='미체결수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    comm_ord_tp: str | None = Field(None, alias='comm_ord_tp', description='통신구분')
    mdfy_cncl_tp: str | None = Field(None, alias='mdfy_cncl_tp', description='정정취소구분')
    dmst_stex_tp: str | None = Field(None, alias='dmst_stex_tp', description='국내거래소구분')
    cond_uv: str | None = Field(None, alias='cond_uv', description='스톱가 — 단위: 원, 좌측 0-padding 처리된 부호 포함 10자리 숫자')


class Kt50075Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50075'
    acnt_ord_oso_prst: list[Kt50075ResponseAcntOrdOsoPrstItem] = Field(default_factory=list, alias='acnt_ord_oso_prst', description='계좌별주문미체결현황')


class Ka10001IdentityAndCapitalResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    setl_mm: str | None = Field(None, alias='setl_mm', description='결산월')
    fav: str | None = Field(None, alias='fav', description='액면가 — 단위: 원')
    cap: str | None = Field(None, alias='cap', description='자본금 — 단위: 억원')
    flo_stk: str | None = Field(None, alias='flo_stk', description='상장주식 — 단위: 천원')


class Ka10001MarketScaleAndOwnershipResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    crd_rt: str | None = Field(None, alias='crd_rt', description='신용비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    mac: str | None = Field(None, alias='mac', description='시가총액 — 단위: 억원')
    mac_wght: str | None = Field(None, alias='mac_wght', description='시가총액비중')
    for_exh_rt: str | None = Field(None, alias='for_exh_rt', description='외인소진률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    repl_pric: str | None = Field(None, alias='repl_pric', description='대용가 — 단위: 원')
    fav_unit: str | None = Field(None, alias='fav_unit', description='액면가단위')
    dstr_stk: str | None = Field(None, alias='dstr_stk', description='유통주식 — 단위: 1주')
    dstr_rt: str | None = Field(None, alias='dstr_rt', description='유통비율 — 단위: %, 부호 포함 소수점 첫째 자리까지 포맷된 백분율')


class Ka10001PriceRangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    oyr_hgst: str | None = Field(None, alias='oyr_hgst', description='연중최고 — 단위: 원, 부호가 포함된 숫자')
    oyr_lwst: str | None = Field(None, alias='oyr_lwst', description='연중최저 — 단위: 원, 부호가 포함된 숫자')
    f_250hgst: str | None = Field(None, alias='250hgst', description='250최고 — 단위: 원, 부호가 포함된 숫자')
    f_250lwst: str | None = Field(None, alias='250lwst', description='250최저 — 단위: 원, 부호가 포함된 숫자')
    f_250hgst_pric_dt: str | None = Field(None, alias='250hgst_pric_dt', description='250최고가일 — YYYYMMDD')
    f_250hgst_pric_pre_rt: str | None = Field(None, alias='250hgst_pric_pre_rt', description='250최고가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_250lwst_pric_dt: str | None = Field(None, alias='250lwst_pric_dt', description='250최저가일 — YYYYMMDD')
    f_250lwst_pric_pre_rt: str | None = Field(None, alias='250lwst_pric_pre_rt', description='250최저가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10001ValuationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    per: str | None = Field(None, alias='per', description='PER — [ 주의 ] PER, ROE 값들은 외부벤더사에서 제공되는 데이터이며 일주일에 한번 또는 실적발표 시즌에 업데이트 됨')
    eps: str | None = Field(None, alias='eps', description='EPS')
    roe: str | None = Field(None, alias='roe', description='ROE — [ 주의 ]  PER, ROE 값들은 외부벤더사에서 제공되는 데이터이며 일주일에 한번 또는 실적발표 시즌에 업데이트 됨')
    pbr: str | None = Field(None, alias='pbr', description='PBR')
    ev: str | None = Field(None, alias='ev', description='EV')
    bps: str | None = Field(None, alias='bps', description='BPS')


class Ka10001FinancialPerformanceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    sale_amt: str | None = Field(None, alias='sale_amt', description='매출액 — 단위: 억원')
    bus_pro: str | None = Field(None, alias='bus_pro', description='영업이익 — 단위: 억원')
    cup_nga: str | None = Field(None, alias='cup_nga', description='당기순이익 — 단위: 억원')


class Ka10001DailyPriceBandResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    upl_pric: str | None = Field(None, alias='upl_pric', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    lst_pric: str | None = Field(None, alias='lst_pric', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상체결가')
    exp_cntr_qty: str | None = Field(None, alias='exp_cntr_qty', description='예상체결수량')


class Ka10001CurrentTradingResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10001'
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pre_sig: str | None = Field(None, alias='pre_sig', description='대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_pre: str | None = Field(None, alias='trde_pre', description='거래대비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10002MarketSnapshotResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10002'
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    flu_smbol: str | None = Field(None, alias='flu_smbol', description='등락부호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    base_pric: str | None = Field(None, alias='base_pric', description='기준가 — 단위: 원')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10002SellBrokersResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10002'
    sel_trde_ori_nm_1: str | None = Field(None, alias='sel_trde_ori_nm_1', description='매도거래원명1')
    sel_trde_ori_1: str | None = Field(None, alias='sel_trde_ori_1', description='매도거래원1')
    sel_trde_qty_1: str | None = Field(None, alias='sel_trde_qty_1', description='매도거래량1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_2: str | None = Field(None, alias='sel_trde_ori_nm_2', description='매도거래원명2')
    sel_trde_ori_2: str | None = Field(None, alias='sel_trde_ori_2', description='매도거래원2')
    sel_trde_qty_2: str | None = Field(None, alias='sel_trde_qty_2', description='매도거래량2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_3: str | None = Field(None, alias='sel_trde_ori_nm_3', description='매도거래원명3')
    sel_trde_ori_3: str | None = Field(None, alias='sel_trde_ori_3', description='매도거래원3')
    sel_trde_qty_3: str | None = Field(None, alias='sel_trde_qty_3', description='매도거래량3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_4: str | None = Field(None, alias='sel_trde_ori_nm_4', description='매도거래원명4')
    sel_trde_ori_4: str | None = Field(None, alias='sel_trde_ori_4', description='매도거래원4')
    sel_trde_qty_4: str | None = Field(None, alias='sel_trde_qty_4', description='매도거래량4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_nm_5: str | None = Field(None, alias='sel_trde_ori_nm_5', description='매도거래원명5')
    sel_trde_ori_5: str | None = Field(None, alias='sel_trde_ori_5', description='매도거래원5')
    sel_trde_qty_5: str | None = Field(None, alias='sel_trde_qty_5', description='매도거래량5 — 단위: 1주, 부호가 포함된 숫자')


class Ka10002BuyBrokersResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10002'
    buy_trde_ori_nm_1: str | None = Field(None, alias='buy_trde_ori_nm_1', description='매수거래원명1')
    buy_trde_ori_1: str | None = Field(None, alias='buy_trde_ori_1', description='매수거래원1')
    buy_trde_qty_1: str | None = Field(None, alias='buy_trde_qty_1', description='매수거래량1 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_2: str | None = Field(None, alias='buy_trde_ori_nm_2', description='매수거래원명2')
    buy_trde_ori_2: str | None = Field(None, alias='buy_trde_ori_2', description='매수거래원2')
    buy_trde_qty_2: str | None = Field(None, alias='buy_trde_qty_2', description='매수거래량2 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_3: str | None = Field(None, alias='buy_trde_ori_nm_3', description='매수거래원명3')
    buy_trde_ori_3: str | None = Field(None, alias='buy_trde_ori_3', description='매수거래원3')
    buy_trde_qty_3: str | None = Field(None, alias='buy_trde_qty_3', description='매수거래량3 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_4: str | None = Field(None, alias='buy_trde_ori_nm_4', description='매수거래원명4')
    buy_trde_ori_4: str | None = Field(None, alias='buy_trde_ori_4', description='매수거래원4')
    buy_trde_qty_4: str | None = Field(None, alias='buy_trde_qty_4', description='매수거래량4 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_nm_5: str | None = Field(None, alias='buy_trde_ori_nm_5', description='매수거래원명5')
    buy_trde_ori_5: str | None = Field(None, alias='buy_trde_ori_5', description='매수거래원5')
    buy_trde_qty_5: str | None = Field(None, alias='buy_trde_qty_5', description='매수거래량5 — 단위: 1주, 부호가 포함된 숫자')


class Ka10004SnapshotTimeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    bid_req_base_tm: str | None = Field(None, alias='bid_req_base_tm', description='호가잔량기준시간 — YYYYMMDD')


class Ka10004SellBidPricesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    sel_10th_pre_bid: str | None = Field(None, alias='sel_10th_pre_bid', description='매도10차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_9th_pre_bid: str | None = Field(None, alias='sel_9th_pre_bid', description='매도9차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_8th_pre_bid: str | None = Field(None, alias='sel_8th_pre_bid', description='매도8차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_7th_pre_bid: str | None = Field(None, alias='sel_7th_pre_bid', description='매도7차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_6th_pre_bid: str | None = Field(None, alias='sel_6th_pre_bid', description='매도6차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_5th_pre_bid: str | None = Field(None, alias='sel_5th_pre_bid', description='매도5차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_4th_pre_bid: str | None = Field(None, alias='sel_4th_pre_bid', description='매도4차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_3th_pre_bid: str | None = Field(None, alias='sel_3th_pre_bid', description='매도3차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_2th_pre_bid: str | None = Field(None, alias='sel_2th_pre_bid', description='매도2차선호가 — 단위: 원, 부호가 포함된 숫자')
    sel_fpr_bid: str | None = Field(None, alias='sel_fpr_bid', description='매도최우선호가 — 단위: 원, 부호가 포함된 숫자')


class Ka10004SellBidQuantitiesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    sel_10th_pre_req: str | None = Field(None, alias='sel_10th_pre_req', description='매도10차선잔량 — 단위: 1주')
    sel_9th_pre_req: str | None = Field(None, alias='sel_9th_pre_req', description='매도9차선잔량 — 단위: 1주')
    sel_8th_pre_req: str | None = Field(None, alias='sel_8th_pre_req', description='매도8차선잔량 — 단위: 1주')
    sel_7th_pre_req: str | None = Field(None, alias='sel_7th_pre_req', description='매도7차선잔량 — 단위: 1주')
    sel_6th_pre_req: str | None = Field(None, alias='sel_6th_pre_req', description='매도6차선잔량 — 단위: 1주')
    sel_5th_pre_req: str | None = Field(None, alias='sel_5th_pre_req', description='매도5차선잔량 — 단위: 1주')
    sel_4th_pre_req: str | None = Field(None, alias='sel_4th_pre_req', description='매도4차선잔량 — 단위: 1주')
    sel_3th_pre_req: str | None = Field(None, alias='sel_3th_pre_req', description='매도3차선잔량 — 단위: 1주')
    sel_2th_pre_req: str | None = Field(None, alias='sel_2th_pre_req', description='매도2차선잔량 — 단위: 1주')
    sel_fpr_req: str | None = Field(None, alias='sel_fpr_req', description='매도최우선잔량 — 단위: 1주')


class Ka10004SellBidChangesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    sel_10th_pre_req_pre: str | None = Field(None, alias='sel_10th_pre_req_pre', description='매도10차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_9th_pre_req_pre: str | None = Field(None, alias='sel_9th_pre_req_pre', description='매도9차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_8th_pre_req_pre: str | None = Field(None, alias='sel_8th_pre_req_pre', description='매도8차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_7th_pre_req_pre: str | None = Field(None, alias='sel_7th_pre_req_pre', description='매도7차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_6th_pre_req_pre: str | None = Field(None, alias='sel_6th_pre_req_pre', description='매도6차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_5th_pre_req_pre: str | None = Field(None, alias='sel_5th_pre_req_pre', description='매도5차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_4th_pre_req_pre: str | None = Field(None, alias='sel_4th_pre_req_pre', description='매도4차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_3th_pre_req_pre: str | None = Field(None, alias='sel_3th_pre_req_pre', description='매도3차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_2th_pre_req_pre: str | None = Field(None, alias='sel_2th_pre_req_pre', description='매도2차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_1th_pre_req_pre: str | None = Field(None, alias='sel_1th_pre_req_pre', description='매도1차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')


class Ka10004BuyBidPricesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    buy_fpr_bid: str | None = Field(None, alias='buy_fpr_bid', description='매수최우선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_2th_pre_bid: str | None = Field(None, alias='buy_2th_pre_bid', description='매수2차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_3th_pre_bid: str | None = Field(None, alias='buy_3th_pre_bid', description='매수3차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_4th_pre_bid: str | None = Field(None, alias='buy_4th_pre_bid', description='매수4차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_5th_pre_bid: str | None = Field(None, alias='buy_5th_pre_bid', description='매수5차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_6th_pre_bid: str | None = Field(None, alias='buy_6th_pre_bid', description='매수6차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_7th_pre_bid: str | None = Field(None, alias='buy_7th_pre_bid', description='매수7차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_8th_pre_bid: str | None = Field(None, alias='buy_8th_pre_bid', description='매수8차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_9th_pre_bid: str | None = Field(None, alias='buy_9th_pre_bid', description='매수9차선호가 — 단위: 원, 부호가 포함된 숫자')
    buy_10th_pre_bid: str | None = Field(None, alias='buy_10th_pre_bid', description='매수10차선호가 — 단위: 원, 부호가 포함된 숫자')


class Ka10004BuyBidQuantitiesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    buy_fpr_req: str | None = Field(None, alias='buy_fpr_req', description='매수최우선잔량 — 단위: 1주')
    buy_2th_pre_req: str | None = Field(None, alias='buy_2th_pre_req', description='매수2차선잔량 — 단위: 1주')
    buy_3th_pre_req: str | None = Field(None, alias='buy_3th_pre_req', description='매수3차선잔량 — 단위: 1주')
    buy_4th_pre_req: str | None = Field(None, alias='buy_4th_pre_req', description='매수4차선잔량 — 단위: 1주')
    buy_5th_pre_req: str | None = Field(None, alias='buy_5th_pre_req', description='매수5차선잔량 — 단위: 1주')
    buy_6th_pre_req: str | None = Field(None, alias='buy_6th_pre_req', description='매수6차선잔량 — 단위: 1주')
    buy_7th_pre_req: str | None = Field(None, alias='buy_7th_pre_req', description='매수7차선잔량 — 단위: 1주')
    buy_8th_pre_req: str | None = Field(None, alias='buy_8th_pre_req', description='매수8차선잔량 — 단위: 1주')
    buy_9th_pre_req: str | None = Field(None, alias='buy_9th_pre_req', description='매수9차선잔량 — 단위: 1주')
    buy_10th_pre_req: str | None = Field(None, alias='buy_10th_pre_req', description='매수10차선잔량 — 단위: 1주')


class Ka10004BuyBidChangesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    buy_1th_pre_req_pre: str | None = Field(None, alias='buy_1th_pre_req_pre', description='매수1차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_2th_pre_req_pre: str | None = Field(None, alias='buy_2th_pre_req_pre', description='매수2차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_3th_pre_req_pre: str | None = Field(None, alias='buy_3th_pre_req_pre', description='매수3차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_4th_pre_req_pre: str | None = Field(None, alias='buy_4th_pre_req_pre', description='매수4차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_5th_pre_req_pre: str | None = Field(None, alias='buy_5th_pre_req_pre', description='매수5차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_6th_pre_req_pre: str | None = Field(None, alias='buy_6th_pre_req_pre', description='매수6차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_7th_pre_req_pre: str | None = Field(None, alias='buy_7th_pre_req_pre', description='매수7차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_8th_pre_req_pre: str | None = Field(None, alias='buy_8th_pre_req_pre', description='매수8차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_9th_pre_req_pre: str | None = Field(None, alias='buy_9th_pre_req_pre', description='매수9차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_10th_pre_req_pre: str | None = Field(None, alias='buy_10th_pre_req_pre', description='매수10차선잔량대비 — 단위: 1주, 부호가 포함된 숫자')


class Ka10004AggregateTotalsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    tot_sel_req_jub_pre: str | None = Field(None, alias='tot_sel_req_jub_pre', description='총매도잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')
    tot_buy_req_jub_pre: str | None = Field(None, alias='tot_buy_req_jub_pre', description='총매수잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')


class Ka10004AfterHoursTotalsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10004'
    ovt_sel_req_pre: str | None = Field(None, alias='ovt_sel_req_pre', description='시간외매도잔량대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_req: str | None = Field(None, alias='ovt_sel_req', description='시간외매도잔량 — 단위: 1주, 시간외 매도호가 총잔량')
    ovt_buy_req: str | None = Field(None, alias='ovt_buy_req', description='시간외매수잔량 — 단위: 1주, 시간외 매수호가 총잔량')
    ovt_buy_req_pre: str | None = Field(None, alias='ovt_buy_req_pre', description='시간외매수잔량대비 — 단위: 1주, 부호가 포함된 숫자, 시간외 매수호가 총잔량 직전대비')


class Ka10007IdentityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    stk_nm: str | None = Field(None, alias='stk_nm', description='종목명')
    stk_cd: str | None = Field(None, alias='stk_cd', description='종목코드')
    date: str | None = Field(None, alias='date', description='날짜 — YYYYMMDD')
    tm: str | None = Field(None, alias='tm', description='시간 — HHmmss')


class Ka10007ExpectedMarketResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    pred_close_pric: str | None = Field(None, alias='pred_close_pric', description='전일종가 — 단위: 원')
    pred_trde_qty: str | None = Field(None, alias='pred_trde_qty', description='전일거래량 — 단위: 1주')
    upl_pric: str | None = Field(None, alias='upl_pric', description='상한가 — 단위: 원, 부호가 포함된 숫자')
    lst_pric: str | None = Field(None, alias='lst_pric', description='하한가 — 단위: 원, 부호가 포함된 숫자')
    pred_trde_prica: str | None = Field(None, alias='pred_trde_prica', description='전일거래대금 — 단위: 백만원')
    flo_stkcnt: str | None = Field(None, alias='flo_stkcnt', description='상장주식수 — 단위: 1주')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    smbol: str | None = Field(None, alias='smbol', description='부호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    pred_rt: str | None = Field(None, alias='pred_rt', description='전일비 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka10007SessionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 원, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 원, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 원, 부호가 포함된 숫자')
    cntr_qty: str | None = Field(None, alias='cntr_qty', description='체결량 — 단위: 1주')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    exp_cntr_pric: str | None = Field(None, alias='exp_cntr_pric', description='예상체결가 — 단위: 원, 부호가 포함된 숫자')
    exp_cntr_qty: str | None = Field(None, alias='exp_cntr_qty', description='예상체결량 — 단위: 1주')
    exp_sel_pri_bid: str | None = Field(None, alias='exp_sel_pri_bid', description='예상매도우선호가 — 단위: 원, 부호가 포함된 숫자')
    exp_buy_pri_bid: str | None = Field(None, alias='exp_buy_pri_bid', description='예상매수우선호가 — 단위: 원, 부호가 포함된 숫자')
    trde_strt_dt: str | None = Field(None, alias='trde_strt_dt', description='거래시작일 — YYYYMMDD')
    exec_pric: str | None = Field(None, alias='exec_pric', description='행사가격 — 단위: 원')
    hgst_pric: str | None = Field(None, alias='hgst_pric', description='최고가 — 단위: 원, 부호가 포함된 숫자')
    lwst_pric: str | None = Field(None, alias='lwst_pric', description='최저가 — 단위: 원, 부호가 포함된 숫자')
    hgst_pric_dt: str | None = Field(None, alias='hgst_pric_dt', description='최고가일 — YYYYMMDD')
    lwst_pric_dt: str | None = Field(None, alias='lwst_pric_dt', description='최저가일 — YYYYMMDD')


class Ka10007BidPricesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    sel_1bid: str | None = Field(None, alias='sel_1bid', description='매도1호가 — 단위: 원, 부호가 포함된 숫자')
    sel_2bid: str | None = Field(None, alias='sel_2bid', description='매도2호가 — 단위: 원, 부호가 포함된 숫자')
    sel_3bid: str | None = Field(None, alias='sel_3bid', description='매도3호가 — 단위: 원, 부호가 포함된 숫자')
    sel_4bid: str | None = Field(None, alias='sel_4bid', description='매도4호가 — 단위: 원, 부호가 포함된 숫자')
    sel_5bid: str | None = Field(None, alias='sel_5bid', description='매도5호가 — 단위: 원, 부호가 포함된 숫자')
    sel_6bid: str | None = Field(None, alias='sel_6bid', description='매도6호가 — 단위: 원, 부호가 포함된 숫자')
    sel_7bid: str | None = Field(None, alias='sel_7bid', description='매도7호가 — 단위: 원, 부호가 포함된 숫자')
    sel_8bid: str | None = Field(None, alias='sel_8bid', description='매도8호가 — 단위: 원, 부호가 포함된 숫자')
    sel_9bid: str | None = Field(None, alias='sel_9bid', description='매도9호가 — 단위: 원, 부호가 포함된 숫자')
    sel_10bid: str | None = Field(None, alias='sel_10bid', description='매도10호가 — 단위: 원, 부호가 포함된 숫자')
    buy_1bid: str | None = Field(None, alias='buy_1bid', description='매수1호가 — 단위: 원, 부호가 포함된 숫자')
    buy_2bid: str | None = Field(None, alias='buy_2bid', description='매수2호가 — 단위: 원, 부호가 포함된 숫자')
    buy_3bid: str | None = Field(None, alias='buy_3bid', description='매수3호가 — 단위: 원, 부호가 포함된 숫자')
    buy_4bid: str | None = Field(None, alias='buy_4bid', description='매수4호가 — 단위: 원, 부호가 포함된 숫자')
    buy_5bid: str | None = Field(None, alias='buy_5bid', description='매수5호가 — 단위: 원, 부호가 포함된 숫자')
    buy_6bid: str | None = Field(None, alias='buy_6bid', description='매수6호가 — 단위: 원, 부호가 포함된 숫자')
    buy_7bid: str | None = Field(None, alias='buy_7bid', description='매수7호가 — 단위: 원, 부호가 포함된 숫자')
    buy_8bid: str | None = Field(None, alias='buy_8bid', description='매수8호가 — 단위: 원, 부호가 포함된 숫자')
    buy_9bid: str | None = Field(None, alias='buy_9bid', description='매수9호가 — 단위: 원, 부호가 포함된 숫자')
    buy_10bid: str | None = Field(None, alias='buy_10bid', description='매수10호가 — 단위: 원, 부호가 포함된 숫자')


class Ka10007BidQuantitiesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    sel_1bid_req: str | None = Field(None, alias='sel_1bid_req', description='매도1호가잔량 — 단위: 1주')
    sel_2bid_req: str | None = Field(None, alias='sel_2bid_req', description='매도2호가잔량 — 단위: 1주')
    sel_3bid_req: str | None = Field(None, alias='sel_3bid_req', description='매도3호가잔량 — 단위: 1주')
    sel_4bid_req: str | None = Field(None, alias='sel_4bid_req', description='매도4호가잔량 — 단위: 1주')
    sel_5bid_req: str | None = Field(None, alias='sel_5bid_req', description='매도5호가잔량 — 단위: 1주')
    sel_6bid_req: str | None = Field(None, alias='sel_6bid_req', description='매도6호가잔량 — 단위: 1주')
    sel_7bid_req: str | None = Field(None, alias='sel_7bid_req', description='매도7호가잔량 — 단위: 1주')
    sel_8bid_req: str | None = Field(None, alias='sel_8bid_req', description='매도8호가잔량 — 단위: 1주')
    sel_9bid_req: str | None = Field(None, alias='sel_9bid_req', description='매도9호가잔량 — 단위: 1주')
    sel_10bid_req: str | None = Field(None, alias='sel_10bid_req', description='매도10호가잔량 — 단위: 1주')
    buy_1bid_req: str | None = Field(None, alias='buy_1bid_req', description='매수1호가잔량 — 단위: 1주')
    buy_2bid_req: str | None = Field(None, alias='buy_2bid_req', description='매수2호가잔량 — 단위: 1주')
    buy_3bid_req: str | None = Field(None, alias='buy_3bid_req', description='매수3호가잔량 — 단위: 1주')
    buy_4bid_req: str | None = Field(None, alias='buy_4bid_req', description='매수4호가잔량 — 단위: 1주')
    buy_5bid_req: str | None = Field(None, alias='buy_5bid_req', description='매수5호가잔량 — 단위: 1주')
    buy_6bid_req: str | None = Field(None, alias='buy_6bid_req', description='매수6호가잔량 — 단위: 1주')
    buy_7bid_req: str | None = Field(None, alias='buy_7bid_req', description='매수7호가잔량 — 단위: 1주')
    buy_8bid_req: str | None = Field(None, alias='buy_8bid_req', description='매수8호가잔량 — 단위: 1주')
    buy_9bid_req: str | None = Field(None, alias='buy_9bid_req', description='매수9호가잔량 — 단위: 1주')
    buy_10bid_req: str | None = Field(None, alias='buy_10bid_req', description='매수10호가잔량 — 단위: 1주')


class Ka10007BidChangesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    sel_1bid_jub_pre: str | None = Field(None, alias='sel_1bid_jub_pre', description='매도1호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_2bid_jub_pre: str | None = Field(None, alias='sel_2bid_jub_pre', description='매도2호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_3bid_jub_pre: str | None = Field(None, alias='sel_3bid_jub_pre', description='매도3호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_4bid_jub_pre: str | None = Field(None, alias='sel_4bid_jub_pre', description='매도4호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_5bid_jub_pre: str | None = Field(None, alias='sel_5bid_jub_pre', description='매도5호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_6bid_jub_pre: str | None = Field(None, alias='sel_6bid_jub_pre', description='매도6호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_7bid_jub_pre: str | None = Field(None, alias='sel_7bid_jub_pre', description='매도7호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_8bid_jub_pre: str | None = Field(None, alias='sel_8bid_jub_pre', description='매도8호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_9bid_jub_pre: str | None = Field(None, alias='sel_9bid_jub_pre', description='매도9호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_10bid_jub_pre: str | None = Field(None, alias='sel_10bid_jub_pre', description='매도10호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_1bid_jub_pre: str | None = Field(None, alias='buy_1bid_jub_pre', description='매수1호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_2bid_jub_pre: str | None = Field(None, alias='buy_2bid_jub_pre', description='매수2호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_3bid_jub_pre: str | None = Field(None, alias='buy_3bid_jub_pre', description='매수3호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_4bid_jub_pre: str | None = Field(None, alias='buy_4bid_jub_pre', description='매수4호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_5bid_jub_pre: str | None = Field(None, alias='buy_5bid_jub_pre', description='매수5호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_6bid_jub_pre: str | None = Field(None, alias='buy_6bid_jub_pre', description='매수6호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_7bid_jub_pre: str | None = Field(None, alias='buy_7bid_jub_pre', description='매수7호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_8bid_jub_pre: str | None = Field(None, alias='buy_8bid_jub_pre', description='매수8호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_9bid_jub_pre: str | None = Field(None, alias='buy_9bid_jub_pre', description='매수9호가직전대비 — 단위: 1주, 부호가 포함된 숫자')
    buy_10bid_jub_pre: str | None = Field(None, alias='buy_10bid_jub_pre', description='매수10호가직전대비 — 단위: 1주, 부호가 포함된 숫자')


class Ka10007OrderCountsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    sel_1bid_cnt: str | None = Field(None, alias='sel_1bid_cnt', description='매도1호가건수')
    sel_2bid_cnt: str | None = Field(None, alias='sel_2bid_cnt', description='매도2호가건수')
    sel_3bid_cnt: str | None = Field(None, alias='sel_3bid_cnt', description='매도3호가건수')
    sel_4bid_cnt: str | None = Field(None, alias='sel_4bid_cnt', description='매도4호가건수')
    sel_5bid_cnt: str | None = Field(None, alias='sel_5bid_cnt', description='매도5호가건수')
    buy_1bid_cnt: str | None = Field(None, alias='buy_1bid_cnt', description='매수1호가건수')
    buy_2bid_cnt: str | None = Field(None, alias='buy_2bid_cnt', description='매수2호가건수')
    buy_3bid_cnt: str | None = Field(None, alias='buy_3bid_cnt', description='매수3호가건수')
    buy_4bid_cnt: str | None = Field(None, alias='buy_4bid_cnt', description='매수4호가건수')
    buy_5bid_cnt: str | None = Field(None, alias='buy_5bid_cnt', description='매수5호가건수')


class Ka10007LiquidityProviderResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    lpsel_1bid_req: str | None = Field(None, alias='lpsel_1bid_req', description='LP매도1호가잔량 — 단위: 1주')
    lpsel_2bid_req: str | None = Field(None, alias='lpsel_2bid_req', description='LP매도2호가잔량 — 단위: 1주')
    lpsel_3bid_req: str | None = Field(None, alias='lpsel_3bid_req', description='LP매도3호가잔량 — 단위: 1주')
    lpsel_4bid_req: str | None = Field(None, alias='lpsel_4bid_req', description='LP매도4호가잔량 — 단위: 1주')
    lpsel_5bid_req: str | None = Field(None, alias='lpsel_5bid_req', description='LP매도5호가잔량 — 단위: 1주')
    lpsel_6bid_req: str | None = Field(None, alias='lpsel_6bid_req', description='LP매도6호가잔량 — 단위: 1주')
    lpsel_7bid_req: str | None = Field(None, alias='lpsel_7bid_req', description='LP매도7호가잔량 — 단위: 1주')
    lpsel_8bid_req: str | None = Field(None, alias='lpsel_8bid_req', description='LP매도8호가잔량 — 단위: 1주')
    lpsel_9bid_req: str | None = Field(None, alias='lpsel_9bid_req', description='LP매도9호가잔량 — 단위: 1주')
    lpsel_10bid_req: str | None = Field(None, alias='lpsel_10bid_req', description='LP매도10호가잔량 — 단위: 1주')
    lpbuy_1bid_req: str | None = Field(None, alias='lpbuy_1bid_req', description='LP매수1호가잔량 — 단위: 1주')
    lpbuy_2bid_req: str | None = Field(None, alias='lpbuy_2bid_req', description='LP매수2호가잔량 — 단위: 1주')
    lpbuy_3bid_req: str | None = Field(None, alias='lpbuy_3bid_req', description='LP매수3호가잔량 — 단위: 1주')
    lpbuy_4bid_req: str | None = Field(None, alias='lpbuy_4bid_req', description='LP매수4호가잔량 — 단위: 1주')
    lpbuy_5bid_req: str | None = Field(None, alias='lpbuy_5bid_req', description='LP매수5호가잔량 — 단위: 1주')
    lpbuy_6bid_req: str | None = Field(None, alias='lpbuy_6bid_req', description='LP매수6호가잔량 — 단위: 1주')
    lpbuy_7bid_req: str | None = Field(None, alias='lpbuy_7bid_req', description='LP매수7호가잔량 — 단위: 1주')
    lpbuy_8bid_req: str | None = Field(None, alias='lpbuy_8bid_req', description='LP매수8호가잔량 — 단위: 1주')
    lpbuy_9bid_req: str | None = Field(None, alias='lpbuy_9bid_req', description='LP매수9호가잔량 — 단위: 1주')
    lpbuy_10bid_req: str | None = Field(None, alias='lpbuy_10bid_req', description='LP매수10호가잔량 — 단위: 1주')


class Ka10007TotalsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10007'
    tot_buy_req: str | None = Field(None, alias='tot_buy_req', description='총매수잔량 — 단위: 1주')
    tot_sel_req: str | None = Field(None, alias='tot_sel_req', description='총매도잔량 — 단위: 1주')
    tot_buy_cnt: str | None = Field(None, alias='tot_buy_cnt', description='총매수건수')
    tot_sel_cnt: str | None = Field(None, alias='tot_sel_cnt', description='총매도건수')


class Ka10040SellBrokersResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10040'
    sel_trde_ori_irds_1: str | None = Field(None, alias='sel_trde_ori_irds_1', description='매도거래원별증감1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_1: str | None = Field(None, alias='sel_trde_ori_qty_1', description='매도거래원수량1 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_1: str | None = Field(None, alias='sel_trde_ori_1', description='매도거래원1')
    sel_trde_ori_cd_1: str | None = Field(None, alias='sel_trde_ori_cd_1', description='매도거래원코드1')
    sel_trde_ori_irds_2: str | None = Field(None, alias='sel_trde_ori_irds_2', description='매도거래원별증감2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_2: str | None = Field(None, alias='sel_trde_ori_qty_2', description='매도거래원수량2 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_2: str | None = Field(None, alias='sel_trde_ori_2', description='매도거래원2')
    sel_trde_ori_cd_2: str | None = Field(None, alias='sel_trde_ori_cd_2', description='매도거래원코드2')
    sel_trde_ori_irds_3: str | None = Field(None, alias='sel_trde_ori_irds_3', description='매도거래원별증감3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_3: str | None = Field(None, alias='sel_trde_ori_qty_3', description='매도거래원수량3 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_3: str | None = Field(None, alias='sel_trde_ori_3', description='매도거래원3')
    sel_trde_ori_cd_3: str | None = Field(None, alias='sel_trde_ori_cd_3', description='매도거래원코드3')
    sel_trde_ori_irds_4: str | None = Field(None, alias='sel_trde_ori_irds_4', description='매도거래원별증감4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_4: str | None = Field(None, alias='sel_trde_ori_qty_4', description='매도거래원수량4 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_4: str | None = Field(None, alias='sel_trde_ori_4', description='매도거래원4')
    sel_trde_ori_cd_4: str | None = Field(None, alias='sel_trde_ori_cd_4', description='매도거래원코드4')
    sel_trde_ori_irds_5: str | None = Field(None, alias='sel_trde_ori_irds_5', description='매도거래원별증감5 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_qty_5: str | None = Field(None, alias='sel_trde_ori_qty_5', description='매도거래원수량5 — 단위: 1주, 부호가 포함된 숫자')
    sel_trde_ori_5: str | None = Field(None, alias='sel_trde_ori_5', description='매도거래원5')
    sel_trde_ori_cd_5: str | None = Field(None, alias='sel_trde_ori_cd_5', description='매도거래원코드5')


class Ka10040BuyBrokersResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10040'
    buy_trde_ori_1: str | None = Field(None, alias='buy_trde_ori_1', description='매수거래원1')
    buy_trde_ori_cd_1: str | None = Field(None, alias='buy_trde_ori_cd_1', description='매수거래원코드1')
    buy_trde_ori_qty_1: str | None = Field(None, alias='buy_trde_ori_qty_1', description='매수거래원수량1 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_1: str | None = Field(None, alias='buy_trde_ori_irds_1', description='매수거래원별증감1 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_2: str | None = Field(None, alias='buy_trde_ori_2', description='매수거래원2')
    buy_trde_ori_cd_2: str | None = Field(None, alias='buy_trde_ori_cd_2', description='매수거래원코드2')
    buy_trde_ori_qty_2: str | None = Field(None, alias='buy_trde_ori_qty_2', description='매수거래원수량2 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_2: str | None = Field(None, alias='buy_trde_ori_irds_2', description='매수거래원별증감2 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_3: str | None = Field(None, alias='buy_trde_ori_3', description='매수거래원3')
    buy_trde_ori_cd_3: str | None = Field(None, alias='buy_trde_ori_cd_3', description='매수거래원코드3')
    buy_trde_ori_qty_3: str | None = Field(None, alias='buy_trde_ori_qty_3', description='매수거래원수량3 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_3: str | None = Field(None, alias='buy_trde_ori_irds_3', description='매수거래원별증감3 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_4: str | None = Field(None, alias='buy_trde_ori_4', description='매수거래원4')
    buy_trde_ori_cd_4: str | None = Field(None, alias='buy_trde_ori_cd_4', description='매수거래원코드4')
    buy_trde_ori_qty_4: str | None = Field(None, alias='buy_trde_ori_qty_4', description='매수거래원수량4 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_4: str | None = Field(None, alias='buy_trde_ori_irds_4', description='매수거래원별증감4 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_5: str | None = Field(None, alias='buy_trde_ori_5', description='매수거래원5')
    buy_trde_ori_cd_5: str | None = Field(None, alias='buy_trde_ori_cd_5', description='매수거래원코드5')
    buy_trde_ori_qty_5: str | None = Field(None, alias='buy_trde_ori_qty_5', description='매수거래원수량5 — 단위: 1주, 부호가 포함된 숫자')
    buy_trde_ori_irds_5: str | None = Field(None, alias='buy_trde_ori_irds_5', description='매수거래원별증감5 — 단위: 1주, 부호가 포함된 숫자')


class Ka10040ForeignBrokerEstimatesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10040'
    frgn_sel_prsm_sum_chang: str | None = Field(None, alias='frgn_sel_prsm_sum_chang', description='외국계매도추정합변동 — 단위: 1주, 부호가 포함된 숫자')
    frgn_sel_prsm_sum: str | None = Field(None, alias='frgn_sel_prsm_sum', description='외국계매도추정합 — 단위: 1주, 부호가 포함된 숫자')
    frgn_buy_prsm_sum: str | None = Field(None, alias='frgn_buy_prsm_sum', description='외국계매수추정합 — 단위: 1주, 부호가 포함된 숫자')
    frgn_buy_prsm_sum_chang: str | None = Field(None, alias='frgn_buy_prsm_sum_chang', description='외국계매수추정합변동 — 단위: 1주, 부호가 포함된 숫자')


class Ka10040BrokerDeparturesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10040'
    tdy_main_trde_ori: list[Ka10040ResponseTdyMainTrdeOriItem] = Field(default_factory=list, alias='tdy_main_trde_ori', description='당일주요거래원')


class Ka10087SnapshotTimeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    bid_req_base_tm: str | None = Field(None, alias='bid_req_base_tm', description='호가잔량기준시간 — HHmmss')


class Ka10087SellBidChangesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_sel_bid_jub_pre_5: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_5', description='시간외단일가_매도호가직전대비5 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_4: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_4', description='시간외단일가_매도호가직전대비4 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_3: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_3', description='시간외단일가_매도호가직전대비3 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_2: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_2', description='시간외단일가_매도호가직전대비2 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_jub_pre_1: str | None = Field(None, alias='ovt_sigpric_sel_bid_jub_pre_1', description='시간외단일가_매도호가직전대비1 — 단위: 1주, 부호가 포함된 숫자')


class Ka10087SellBidQuantitiesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_sel_bid_qty_5: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_5', description='시간외단일가_매도호가수량5 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_4: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_4', description='시간외단일가_매도호가수량4 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_3: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_3', description='시간외단일가_매도호가수량3 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_2: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_2', description='시간외단일가_매도호가수량2 — 단위: 1주')
    ovt_sigpric_sel_bid_qty_1: str | None = Field(None, alias='ovt_sigpric_sel_bid_qty_1', description='시간외단일가_매도호가수량1 — 단위: 1주')


class Ka10087SellBidPricesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_sel_bid_5: str | None = Field(None, alias='ovt_sigpric_sel_bid_5', description='시간외단일가_매도호가5 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_4: str | None = Field(None, alias='ovt_sigpric_sel_bid_4', description='시간외단일가_매도호가4 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_3: str | None = Field(None, alias='ovt_sigpric_sel_bid_3', description='시간외단일가_매도호가3 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_2: str | None = Field(None, alias='ovt_sigpric_sel_bid_2', description='시간외단일가_매도호가2 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_sel_bid_1: str | None = Field(None, alias='ovt_sigpric_sel_bid_1', description='시간외단일가_매도호가1 — 단위: 원, 부호가 포함된 숫자')


class Ka10087BuyBidPricesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_buy_bid_1: str | None = Field(None, alias='ovt_sigpric_buy_bid_1', description='시간외단일가_매수호가1 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_2: str | None = Field(None, alias='ovt_sigpric_buy_bid_2', description='시간외단일가_매수호가2 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_3: str | None = Field(None, alias='ovt_sigpric_buy_bid_3', description='시간외단일가_매수호가3 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_4: str | None = Field(None, alias='ovt_sigpric_buy_bid_4', description='시간외단일가_매수호가4 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_5: str | None = Field(None, alias='ovt_sigpric_buy_bid_5', description='시간외단일가_매수호가5 — 단위: 원, 부호가 포함된 숫자')


class Ka10087BuyBidQuantitiesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_buy_bid_qty_1: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_1', description='시간외단일가_매수호가수량1 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_2: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_2', description='시간외단일가_매수호가수량2 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_3: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_3', description='시간외단일가_매수호가수량3 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_4: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_4', description='시간외단일가_매수호가수량4 — 단위: 1주')
    ovt_sigpric_buy_bid_qty_5: str | None = Field(None, alias='ovt_sigpric_buy_bid_qty_5', description='시간외단일가_매수호가수량5 — 단위: 1주')


class Ka10087BuyBidChangesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_buy_bid_jub_pre_1: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_1', description='시간외단일가_매수호가직전대비1 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_2: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_2', description='시간외단일가_매수호가직전대비2 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_3: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_3', description='시간외단일가_매수호가직전대비3 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_4: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_4', description='시간외단일가_매수호가직전대비4 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sigpric_buy_bid_jub_pre_5: str | None = Field(None, alias='ovt_sigpric_buy_bid_jub_pre_5', description='시간외단일가_매수호가직전대비5 — 단위: 1주, 부호가 포함된 숫자')


class Ka10087AggregateTotalsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_sel_bid_tot_req: str | None = Field(None, alias='ovt_sigpric_sel_bid_tot_req', description='시간외단일가_매도호가총잔량 — 단위: 1주')
    ovt_sigpric_buy_bid_tot_req: str | None = Field(None, alias='ovt_sigpric_buy_bid_tot_req', description='시간외단일가_매수호가총잔량 — 단위: 1주')
    sel_bid_tot_req_jub_pre: str | None = Field(None, alias='sel_bid_tot_req_jub_pre', description='매도호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    sel_bid_tot_req: str | None = Field(None, alias='sel_bid_tot_req', description='매도호가총잔량 — 단위: 1주')
    buy_bid_tot_req: str | None = Field(None, alias='buy_bid_tot_req', description='매수호가총잔량 — 단위: 1주')
    buy_bid_tot_req_jub_pre: str | None = Field(None, alias='buy_bid_tot_req_jub_pre', description='매수호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_bid_tot_req_jub_pre: str | None = Field(None, alias='ovt_sel_bid_tot_req_jub_pre', description='시간외매도호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')
    ovt_sel_bid_tot_req: str | None = Field(None, alias='ovt_sel_bid_tot_req', description='시간외매도호가총잔량 — 단위: 1주')
    ovt_buy_bid_tot_req: str | None = Field(None, alias='ovt_buy_bid_tot_req', description='시간외매수호가총잔량 — 단위: 1주')
    ovt_buy_bid_tot_req_jub_pre: str | None = Field(None, alias='ovt_buy_bid_tot_req_jub_pre', description='시간외매수호가총잔량직전대비 — 단위: 1주, 부호가 포함된 숫자')


class Ka10087TradingSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka10087'
    ovt_sigpric_cur_prc: str | None = Field(None, alias='ovt_sigpric_cur_prc', description='시간외단일가_현재가 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_pred_pre_sig: str | None = Field(None, alias='ovt_sigpric_pred_pre_sig', description='시간외단일가_전일대비기호')
    ovt_sigpric_pred_pre: str | None = Field(None, alias='ovt_sigpric_pred_pre', description='시간외단일가_전일대비 — 단위: 원, 부호가 포함된 숫자')
    ovt_sigpric_flu_rt: str | None = Field(None, alias='ovt_sigpric_flu_rt', description='시간외단일가_등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    ovt_sigpric_acc_trde_qty: str | None = Field(None, alias='ovt_sigpric_acc_trde_qty', description='시간외단일가_누적거래량 — 단위: 1주')


class Ka20001MarketSnapshotResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20001'
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 지수, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1000주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    trde_frmatn_stk_num: str | None = Field(None, alias='trde_frmatn_stk_num', description='거래형성종목수 — 단위: 종목수')
    trde_frmatn_rt: str | None = Field(None, alias='trde_frmatn_rt', description='거래형성비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka20001SessionRangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20001'
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수, 부호가 포함된 숫자')


class Ka20001MarketBreadthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20001'
    upl: str | None = Field(None, alias='upl', description='상한 — 단위: 종목수')
    rising: str | None = Field(None, alias='rising', description='상승 — 단위: 종목수')
    stdns: str | None = Field(None, alias='stdns', description='보합 — 단위: 종목수')
    fall: str | None = Field(None, alias='fall', description='하락 — 단위: 종목수')
    lst: str | None = Field(None, alias='lst', description='하한 — 단위: 종목수')


class Ka20001FiftyTwoWeekRangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20001'
    f_52wk_hgst_pric: str | None = Field(None, alias='52wk_hgst_pric', description='52주최고가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_hgst_pric_dt: str | None = Field(None, alias='52wk_hgst_pric_dt', description='52주최고가일 — YYYYMMDD')
    f_52wk_hgst_pric_pre_rt: str | None = Field(None, alias='52wk_hgst_pric_pre_rt', description='52주최고가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_52wk_lwst_pric: str | None = Field(None, alias='52wk_lwst_pric', description='52주최저가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_lwst_pric_dt: str | None = Field(None, alias='52wk_lwst_pric_dt', description='52주최저가일 — YYYYMMDD')
    f_52wk_lwst_pric_pre_rt: str | None = Field(None, alias='52wk_lwst_pric_pre_rt', description='52주최저가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka20001IntradayHistoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20001'
    inds_cur_prc_tm: list[Ka20001ResponseIndsCurPrcTmItem] = Field(default_factory=list, alias='inds_cur_prc_tm', description='업종현재가_시간별')


class Ka20009MarketSnapshotResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20009'
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 지수, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 지수, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락률 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    trde_qty: str | None = Field(None, alias='trde_qty', description='거래량 — 단위: 1000주')
    trde_prica: str | None = Field(None, alias='trde_prica', description='거래대금 — 단위: 백만원')
    trde_frmatn_stk_num: str | None = Field(None, alias='trde_frmatn_stk_num', description='거래형성종목수 — 단위: 종목수')
    trde_frmatn_rt: str | None = Field(None, alias='trde_frmatn_rt', description='거래형성비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka20009SessionRangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20009'
    open_pric: str | None = Field(None, alias='open_pric', description='시가 — 단위: 지수, 부호가 포함된 숫자')
    high_pric: str | None = Field(None, alias='high_pric', description='고가 — 단위: 지수, 부호가 포함된 숫자')
    low_pric: str | None = Field(None, alias='low_pric', description='저가 — 단위: 지수, 부호가 포함된 숫자')


class Ka20009MarketBreadthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20009'
    upl: str | None = Field(None, alias='upl', description='상한 — 단위: 종목수')
    rising: str | None = Field(None, alias='rising', description='상승 — 단위: 종목수')
    stdns: str | None = Field(None, alias='stdns', description='보합 — 단위: 종목수')
    fall: str | None = Field(None, alias='fall', description='하락 — 단위: 종목수')
    lst: str | None = Field(None, alias='lst', description='하한 — 단위: 종목수')


class Ka20009FiftyTwoWeekRangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20009'
    f_52wk_hgst_pric: str | None = Field(None, alias='52wk_hgst_pric', description='52주최고가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_hgst_pric_dt: str | None = Field(None, alias='52wk_hgst_pric_dt', description='52주최고가일 — YYYYMMDD')
    f_52wk_hgst_pric_pre_rt: str | None = Field(None, alias='52wk_hgst_pric_pre_rt', description='52주최고가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    f_52wk_lwst_pric: str | None = Field(None, alias='52wk_lwst_pric', description='52주최저가 — 단위: 지수, 부호가 포함된 숫자')
    f_52wk_lwst_pric_dt: str | None = Field(None, alias='52wk_lwst_pric_dt', description='52주최저가일 — YYYYMMDD')
    f_52wk_lwst_pric_pre_rt: str | None = Field(None, alias='52wk_lwst_pric_pre_rt', description='52주최저가대비율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka20009DailyHistoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka20009'
    inds_cur_prc_daly_rept: list[Ka20009ResponseIndsCurPrcDalyReptItem] = Field(default_factory=list, alias='inds_cur_prc_daly_rept', description='업종현재가_일별반복')


class Ka30012MarketSnapshotResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    aset_cd: str | None = Field(None, alias='aset_cd', description='자산코드')
    cur_prc: str | None = Field(None, alias='cur_prc', description='현재가 — 단위: 원, 부호가 포함된 숫자')
    pred_pre_sig: str | None = Field(None, alias='pred_pre_sig', description='전일대비기호 — 1: 상한가, 2:상승, 3:보합, 4:하한가, 5:하락')
    pred_pre: str | None = Field(None, alias='pred_pre', description='전일대비 — 단위: 원, 부호가 포함된 숫자')
    flu_rt: str | None = Field(None, alias='flu_rt', description='등락율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')


class Ka30012LiquidityProvidersResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    lpmmcm_nm: str | None = Field(None, alias='lpmmcm_nm', description='LP회원사명')
    lpmmcm_nm_1: str | None = Field(None, alias='lpmmcm_nm_1', description='LP회원사명1')
    lpmmcm_nm_2: str | None = Field(None, alias='lpmmcm_nm_2', description='LP회원사명2')


class Ka30012ValuationAndRightsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    elwrght_cntn: str | None = Field(None, alias='elwrght_cntn', description='ELW권리내용')
    elwexpr_evlt_pric: str | None = Field(None, alias='elwexpr_evlt_pric', description='ELW만기평가가격')
    elwtheory_pric: str | None = Field(None, alias='elwtheory_pric', description='ELW이론가 — 소수점 제거 된 100배 값으로 제공\n \n예) "4234322"값은 42,344.22를 의미합니다.')
    dispty_rt: str | None = Field(None, alias='dispty_rt', description='괴리율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    elwinnr_vltl: str | None = Field(None, alias='elwinnr_vltl', description='ELW내재변동성')
    exp_rght_pric: str | None = Field(None, alias='exp_rght_pric', description='예상권리가')
    elwpl_qutr_rt: str | None = Field(None, alias='elwpl_qutr_rt', description='ELW손익분기율 — 단위: %, 부호 포함 소수점 둘째 자리까지 포맷된 백분율')
    elwexec_pric: str | None = Field(None, alias='elwexec_pric', description='ELW행사가')
    elwcnvt_rt: str | None = Field(None, alias='elwcnvt_rt', description='ELW전환비율 — 소수점 넷째 자리까지 포맷된 숫자')
    elwcmpn_rt: str | None = Field(None, alias='elwcmpn_rt', description='ELW보상율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    elwpric_rising_part_rt: str | None = Field(None, alias='elwpric_rising_part_rt', description='ELW가격상승참여율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    elwrght_type: str | None = Field(None, alias='elwrght_type', description='ELW권리유형')
    elwsrvive_dys: str | None = Field(None, alias='elwsrvive_dys', description='ELW잔존일수')


class Ka30012LiquidityAndLeverageResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    stkcnt: str | None = Field(None, alias='stkcnt', description='상장주식수 — 단위: 천원')
    elwlpord_pos: str | None = Field(None, alias='elwlpord_pos', description='ELWLP주문가능')
    lpposs_rt: str | None = Field(None, alias='lpposs_rt', description='LP보유비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lprmnd_qty: str | None = Field(None, alias='lprmnd_qty', description='LP보유수량 — 단위: 1주')
    elwspread: str | None = Field(None, alias='elwspread', description='ELW스프레드 — 소수점 둘째 자리까지 포맷된 숫자')
    elwprty: str | None = Field(None, alias='elwprty', description='ELW패리티 — 소수점 둘째 자리까지 포맷된 숫자')
    elwgear: str | None = Field(None, alias='elwgear', description='ELW기어링 — 소수점 둘째 자리까지 포맷된 숫자')


class Ka30012KeyDatesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    elwflo_dt: str | None = Field(None, alias='elwflo_dt', description='ELW상장일 — YYYYMMDD')
    elwfin_trde_dt: str | None = Field(None, alias='elwfin_trde_dt', description='ELW최종거래일 — YYYYMMDD')
    expr_dt: str | None = Field(None, alias='expr_dt', description='만기일 — YYYYMMDD')
    exec_dt: str | None = Field(None, alias='exec_dt', description='행사일 — YYYYMMDD')
    lpsuply_end_dt: str | None = Field(None, alias='lpsuply_end_dt', description='LP공급종료일 — YYYYMMDD')
    elwpay_dt: str | None = Field(None, alias='elwpay_dt', description='ELW지급일 — YYYYMMDD')


class Ka30012AdministrationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    elwinvt_ix_comput: str | None = Field(None, alias='elwinvt_ix_comput', description='ELW투자지표산출')
    elwpay_agnt: str | None = Field(None, alias='elwpay_agnt', description='ELW지급대리인')
    elwappr_way: str | None = Field(None, alias='elwappr_way', description='ELW결재방법')
    elwrght_exec_way: str | None = Field(None, alias='elwrght_exec_way', description='ELW권리행사방식')
    elwpblicte_orgn: str | None = Field(None, alias='elwpblicte_orgn', description='ELW발행기관')


class Ka30012PayoffConditionsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    dcsn_pay_amt: str | None = Field(None, alias='dcsn_pay_amt', description='확정지급액 — 소수점 셋째 자리까지 포맷된 숫자')
    kobarr: str | None = Field(None, alias='kobarr', description='KO베리어')
    iv: str | None = Field(None, alias='iv', description='IV — 소수점 셋째 자리까지 포맷된 숫자')
    clsprd_end_elwocr: str | None = Field(None, alias='clsprd_end_elwocr', description='종기종료ELW발생')


class Ka30012UnderlyingBasketResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    bsis_aset_1: str | None = Field(None, alias='bsis_aset_1', description='기초자산1')
    bsis_aset_comp_rt_1: str | None = Field(None, alias='bsis_aset_comp_rt_1', description='기초자산구성비율1 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_2: str | None = Field(None, alias='bsis_aset_2', description='기초자산2')
    bsis_aset_comp_rt_2: str | None = Field(None, alias='bsis_aset_comp_rt_2', description='기초자산구성비율2 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_3: str | None = Field(None, alias='bsis_aset_3', description='기초자산3')
    bsis_aset_comp_rt_3: str | None = Field(None, alias='bsis_aset_comp_rt_3', description='기초자산구성비율3 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_4: str | None = Field(None, alias='bsis_aset_4', description='기초자산4')
    bsis_aset_comp_rt_4: str | None = Field(None, alias='bsis_aset_comp_rt_4', description='기초자산구성비율4 — 소수점 셋째 자리까지 포맷된 숫자')
    bsis_aset_5: str | None = Field(None, alias='bsis_aset_5', description='기초자산5')
    bsis_aset_comp_rt_5: str | None = Field(None, alias='bsis_aset_comp_rt_5', description='기초자산구성비율5 — 소수점 셋째 자리까지 포맷된 숫자')


class Ka30012EvaluationWindowResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    fr_dt: str | None = Field(None, alias='fr_dt', description='평가시작일자')
    to_dt: str | None = Field(None, alias='to_dt', description='평가종료일자')
    fr_tm: str | None = Field(None, alias='fr_tm', description='평가시작시간')
    evlt_end_tm: str | None = Field(None, alias='evlt_end_tm', description='평가종료시간')
    evlt_pric: str | None = Field(None, alias='evlt_pric', description='평가가격')
    evlt_fnsh_yn: str | None = Field(None, alias='evlt_fnsh_yn', description='평가완료여부')


class Ka30012EvaluationExtremaResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'ka30012'
    all_hgst_pric: str | None = Field(None, alias='all_hgst_pric', description='전체최고가')
    all_lwst_pric: str | None = Field(None, alias='all_lwst_pric', description='전체최저가')
    imaf_hgst_pric: str | None = Field(None, alias='imaf_hgst_pric', description='직후최고가')
    imaf_lwst_pric: str | None = Field(None, alias='imaf_lwst_pric', description='직후최저가')
    sndhalf_mrkt_hgst_pric: str | None = Field(None, alias='sndhalf_mrkt_hgst_pric', description='후반장최고가')
    sndhalf_mrkt_lwst_pric: str | None = Field(None, alias='sndhalf_mrkt_lwst_pric', description='후반장최저가')


class Kt00001CashAndMarginResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    profa_ch: str | None = Field(None, alias='profa_ch', description='주식증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    bncr_profa_ch: str | None = Field(None, alias='bncr_profa_ch', description='수익증권증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    nxdy_bncr_sell_exct: str | None = Field(None, alias='nxdy_bncr_sell_exct', description='익일수익증권매도정산대금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    fc_stk_krw_repl_set_amt: str | None = Field(None, alias='fc_stk_krw_repl_set_amt', description='해외주식원화대용설정금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_ch: str | None = Field(None, alias='crd_grnta_ch', description='신용보증금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_ch: str | None = Field(None, alias='crd_grnt_ch', description='신용담보금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    add_grnt_ch: str | None = Field(None, alias='add_grnt_ch', description='추가담보금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_profa: str | None = Field(None, alias='etc_profa', description='기타증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    uncl_stk_amt: str | None = Field(None, alias='uncl_stk_amt', description='미수확보금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001SpecialDepositsAndCreditResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    shrts_prica: str | None = Field(None, alias='shrts_prica', description='공매도대금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_set_grnta: str | None = Field(None, alias='crd_set_grnta', description='신용설정평가금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    chck_ina_amt: str | None = Field(None, alias='chck_ina_amt', description='수표입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_chck_ina_amt: str | None = Field(None, alias='etc_chck_ina_amt', description='기타수표입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_ruse: str | None = Field(None, alias='crd_grnt_ruse', description='신용담보재사용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    knx_asset_evltv: str | None = Field(None, alias='knx_asset_evltv', description='코넥스기본예탁금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    elwdpst_evlta: str | None = Field(None, alias='elwdpst_evlta', description='ELW예탁평가금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_ls_rght_frcs_amt: str | None = Field(None, alias='crd_ls_rght_frcs_amt', description='신용대주권리예정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    lvlh_join_amt: str | None = Field(None, alias='lvlh_join_amt', description='생계형가입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    lvlh_trns_alowa: str | None = Field(None, alias='lvlh_trns_alowa', description='생계형입금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001SubstituteCollateralResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금평가금액(합계) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    remn_repl_evlta: str | None = Field(None, alias='remn_repl_evlta', description='잔고대용평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    trst_remn_repl_evlta: str | None = Field(None, alias='trst_remn_repl_evlta', description='위탁대용잔고평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    bncr_remn_repl_evlta: str | None = Field(None, alias='bncr_remn_repl_evlta', description='수익증권대용평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    profa_repl: str | None = Field(None, alias='profa_repl', description='위탁증거금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_repl: str | None = Field(None, alias='crd_grnta_repl', description='신용보증금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_repl: str | None = Field(None, alias='crd_grnt_repl', description='신용담보금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    add_grnt_repl: str | None = Field(None, alias='add_grnt_repl', description='추가담보금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    rght_repl_amt: str | None = Field(None, alias='rght_repl_amt', description='권리대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001WithdrawalAndOrderCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    pymn_alow_amt: str | None = Field(None, alias='pymn_alow_amt', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    wrap_pymn_alow_amt: str | None = Field(None, alias='wrap_pymn_alow_amt', description='랩출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ord_alow_amt: str | None = Field(None, alias='ord_alow_amt', description='주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    bncr_buy_alowa: str | None = Field(None, alias='bncr_buy_alowa', description='수익증권매수가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_20stk_ord_alow_amt: str | None = Field(None, alias='20stk_ord_alow_amt', description='20%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_30stk_ord_alow_amt: str | None = Field(None, alias='30stk_ord_alow_amt', description='30%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_40stk_ord_alow_amt: str | None = Field(None, alias='40stk_ord_alow_amt', description='40%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_100stk_ord_alow_amt: str | None = Field(None, alias='100stk_ord_alow_amt', description='100%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_50stk_ord_alow_amt: str | None = Field(None, alias='50stk_ord_alow_amt', description='50%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_60stk_ord_alow_amt: str | None = Field(None, alias='60stk_ord_alow_amt', description='60%종목주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001ReceivablesAndArrearsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    ch_uncla: str | None = Field(None, alias='ch_uncla', description='현금미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_uncla_dlfe: str | None = Field(None, alias='ch_uncla_dlfe', description='현금미수연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_uncla_tot: str | None = Field(None, alias='ch_uncla_tot', description='현금미수금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_int_npay: str | None = Field(None, alias='crd_int_npay', description='신용이자미납 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    int_npay_amt_dlfe: str | None = Field(None, alias='int_npay_amt_dlfe', description='신용이자미납연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    int_npay_amt_tot: str | None = Field(None, alias='int_npay_amt_tot', description='신용이자미납합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loana: str | None = Field(None, alias='etc_loana', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loana_dlfe: str | None = Field(None, alias='etc_loana_dlfe', description='기타대여금연체료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    etc_loan_tot: str | None = Field(None, alias='etc_loan_tot', description='기타대여금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001LoansAndCollateralResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    nrpy_loan: str | None = Field(None, alias='nrpy_loan', description='미상환융자금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    loan_sum: str | None = Field(None, alias='loan_sum', description='융자금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ls_sum: str | None = Field(None, alias='ls_sum', description='대주금합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_rt: str | None = Field(None, alias='crd_grnt_rt', description='신용담보비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    mdstrm_usfe: str | None = Field(None, alias='mdstrm_usfe', description='중도이용료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    min_ord_alow_yn: str | None = Field(None, alias='min_ord_alow_yn', description='최소주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    loan_remn_evlt_amt: str | None = Field(None, alias='loan_remn_evlt_amt', description='대출총평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    dpst_grntl_remn: str | None = Field(None, alias='dpst_grntl_remn', description='예탁담보대출잔고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    sell_grntl_remn: str | None = Field(None, alias='sell_grntl_remn', description='매도담보대출잔고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001SettlementForecastResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    d1_entra: str | None = Field(None, alias='d1_entra', description='d+1추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_slby_exct_amt: str | None = Field(None, alias='d1_slby_exct_amt', description='d+1매도매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_buy_exct_amt: str | None = Field(None, alias='d1_buy_exct_amt', description='d+1매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_out_rep_mor: str | None = Field(None, alias='d1_out_rep_mor', description='d+1미수변제소요금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_sel_exct_amt: str | None = Field(None, alias='d1_sel_exct_amt', description='d+1매도정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d1_pymn_alow_amt: str | None = Field(None, alias='d1_pymn_alow_amt', description='d+1출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_entra: str | None = Field(None, alias='d2_entra', description='d+2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_slby_exct_amt: str | None = Field(None, alias='d2_slby_exct_amt', description='d+2매도매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_buy_exct_amt: str | None = Field(None, alias='d2_buy_exct_amt', description='d+2매수정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_out_rep_mor: str | None = Field(None, alias='d2_out_rep_mor', description='d+2미수변제소요금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_sel_exct_amt: str | None = Field(None, alias='d2_sel_exct_amt', description='d+2매도정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2_pymn_alow_amt: str | None = Field(None, alias='d2_pymn_alow_amt', description='d+2출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00001ForeignCurrencyDepositsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00001'
    stk_entr_prst: list[Kt00001ResponseStkEntrPrstItem] = Field(default_factory=list, alias='stk_entr_prst', description='종목별예수금')


class Kt00004AccountIdentityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00004'
    acnt_nm: str | None = Field(None, alias='acnt_nm', description='계좌명')
    brch_nm: str | None = Field(None, alias='brch_nm', description='지점명')


class Kt00004CashAndAssetsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00004'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    d2_entra: str | None = Field(None, alias='d2_entra', description='D+2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_est_amt: str | None = Field(None, alias='tot_est_amt', description='유가잔고평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    aset_evlt_amt: str | None = Field(None, alias='aset_evlt_amt', description='예탁자산평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_pur_amt: str | None = Field(None, alias='tot_pur_amt', description='총매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    prsm_dpst_aset_amt: str | None = Field(None, alias='prsm_dpst_aset_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_grnt_sella: str | None = Field(None, alias='tot_grnt_sella', description='매도담보대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00004ProfitAndLossResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00004'
    tdy_lspft_amt: str | None = Field(None, alias='tdy_lspft_amt', description='당일투자원금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    invt_bsamt: str | None = Field(None, alias='invt_bsamt', description='당월투자원금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    lspft_amt: str | None = Field(None, alias='lspft_amt', description='누적투자원금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_lspft: str | None = Field(None, alias='tdy_lspft', description='당일투자손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    lspft2: str | None = Field(None, alias='lspft2', description='당월투자손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    lspft: str | None = Field(None, alias='lspft', description='누적투자손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_lspft_rt: str | None = Field(None, alias='tdy_lspft_rt', description='당일손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lspft_ratio: str | None = Field(None, alias='lspft_ratio', description='당월손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    lspft_rt: str | None = Field(None, alias='lspft_rt', description='누적손익율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Kt00004PositionValuationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00004'
    stk_acnt_evlt_prst: list[Kt00004ResponseStkAcntEvltPrstItem] = Field(default_factory=list, alias='stk_acnt_evlt_prst', description='종목별계좌평가현황')


class Kt00005CashAndCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr_d1: str | None = Field(None, alias='entr_d1', description='예수금D+1 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr_d2: str | None = Field(None, alias='entr_d2', description='예수금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pymn_alow_amt: str | None = Field(None, alias='pymn_alow_amt', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncl_stk_amt: str | None = Field(None, alias='uncl_stk_amt', description='미수확보금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rght_repl_amt: str | None = Field(None, alias='rght_repl_amt', description='권리대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00005ReceivablesAndMarginResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    ch_uncla: str | None = Field(None, alias='ch_uncla', description='현금미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold: str | None = Field(None, alias='crd_int_npay_gold', description='신용이자미납금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana: str | None = Field(None, alias='etc_loana', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    nrpy_loan: str | None = Field(None, alias='nrpy_loan', description='미상환융자금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_ch: str | None = Field(None, alias='profa_ch', description='증거금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_profa: str | None = Field(None, alias='repl_profa', description='증거금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00005PortfolioSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    stk_buy_tot_amt: str | None = Field(None, alias='stk_buy_tot_amt', description='주식매수총액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evlt_amt_tot: str | None = Field(None, alias='evlt_amt_tot', description='평가금액합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_pl_tot: str | None = Field(None, alias='tot_pl_tot', description='총손익합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_pl_rt: str | None = Field(None, alias='tot_pl_rt', description='총손익률 — 단위: %, 소수점 넷째 자리까지 포맷된 백분율')
    tot_re_buy_alowa: str | None = Field(None, alias='tot_re_buy_alowa', description='총재매수가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00005MarginOrderCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    f_20ord_alow_amt: str | None = Field(None, alias='20ord_alow_amt', description='20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_30ord_alow_amt: str | None = Field(None, alias='30ord_alow_amt', description='30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_40ord_alow_amt: str | None = Field(None, alias='40ord_alow_amt', description='40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_50ord_alow_amt: str | None = Field(None, alias='50ord_alow_amt', description='50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_60ord_alow_amt: str | None = Field(None, alias='60ord_alow_amt', description='60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    f_100ord_alow_amt: str | None = Field(None, alias='100ord_alow_amt', description='100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00005CreditAndCollateralResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    crd_loan_tot: str | None = Field(None, alias='crd_loan_tot', description='신용융자합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_ls_tot: str | None = Field(None, alias='crd_loan_ls_tot', description='신용융자대주합계 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_grnt_rt: str | None = Field(None, alias='crd_grnt_rt', description='신용담보비율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    dpst_grnt_use_amt_amt: str | None = Field(None, alias='dpst_grnt_use_amt_amt', description='예탁담보대출금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    grnt_loan_amt: str | None = Field(None, alias='grnt_loan_amt', description='매도담보대출금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00005SettledPositionsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00005'
    stk_cntr_remn: list[Kt00005ResponseStkCntrRemnItem] = Field(default_factory=list, alias='stk_cntr_remn', description='종목별체결잔고')


class Kt00009ContractAmountsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00009'
    sell_grntl_engg_amt: str | None = Field(None, alias='sell_grntl_engg_amt', description='매도약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_engg_amt: str | None = Field(None, alias='buy_engg_amt', description='매수약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    engg_amt: str | None = Field(None, alias='engg_amt', description='약정금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00009OrderExecutionStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00009'
    acnt_ord_cntr_prst_array: list[Kt00009ResponseAcntOrdCntrPrstArrayItem] = Field(default_factory=list, alias='acnt_ord_cntr_prst_array', description='계좌별주문체결현황배열')


class Kt00010MarginOrderCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00010'
    profa_20ord_alow_amt: str | None = Field(None, alias='profa_20ord_alow_amt', description='증거금20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20ord_alowq: str | None = Field(None, alias='profa_20ord_alowq', description='증거금20%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_30ord_alow_amt: str | None = Field(None, alias='profa_30ord_alow_amt', description='증거금30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30ord_alowq: str | None = Field(None, alias='profa_30ord_alowq', description='증거금30%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_40ord_alow_amt: str | None = Field(None, alias='profa_40ord_alow_amt', description='증거금40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40ord_alowq: str | None = Field(None, alias='profa_40ord_alowq', description='증거금40%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_50ord_alow_amt: str | None = Field(None, alias='profa_50ord_alow_amt', description='증거금50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50ord_alowq: str | None = Field(None, alias='profa_50ord_alowq', description='증거금50%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_60ord_alow_amt: str | None = Field(None, alias='profa_60ord_alow_amt', description='증거금60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60ord_alowq: str | None = Field(None, alias='profa_60ord_alowq', description='증거금60%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_rdex_60ord_alow_amt: str | None = Field(None, alias='profa_rdex_60ord_alow_amt', description='증거금감면60%주문가능금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_rdex_60ord_alowq: str | None = Field(None, alias='profa_rdex_60ord_alowq', description='증거금감면60%주문가능수 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')
    profa_100ord_alow_amt: str | None = Field(None, alias='profa_100ord_alow_amt', description='증거금100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100ord_alowq: str | None = Field(None, alias='profa_100ord_alowq', description='증거금100%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 10자리 숫자')


class Kt00010CashAndWithdrawalCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00010'
    pred_reu_alowa: str | None = Field(None, alias='pred_reu_alowa', description='전일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tdy_reu_alowa: str | None = Field(None, alias='tdy_reu_alowa', description='금일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_pos_repl: str | None = Field(None, alias='ord_pos_repl', description='주문가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    wthd_alowa: str | None = Field(None, alias='wthd_alowa', description='인출가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    nxdy_wthd_alowa: str | None = Field(None, alias='nxdy_wthd_alowa', description='익일인출가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00010PurchaseSettlementResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00010'
    pur_amt: str | None = Field(None, alias='pur_amt', description='매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pur_exct_amt: str | None = Field(None, alias='pur_exct_amt', description='매입정산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    d2entra: str | None = Field(None, alias='d2entra', description='D2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_rdex_aplc_tp: str | None = Field(None, alias='profa_rdex_aplc_tp', description='증거금감면적용구분 — 0:일반,1:60%감면')


class Kt00011MarginRatesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00011'
    stk_profa_rt: str | None = Field(None, alias='stk_profa_rt', description='종목증거금율 — %가 포함된 백분율 값')
    profa_rt: str | None = Field(None, alias='profa_rt', description='계좌증거금율 — %가 포함된 백분율 값')
    aplc_rt: str | None = Field(None, alias='aplc_rt', description='적용증거금율 — %가 포함된 백분율 값')


class Kt00011MarginCapacity20To50Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00011'
    profa_20ord_alow_amt: str | None = Field(None, alias='profa_20ord_alow_amt', description='증거금20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20ord_alowq: str | None = Field(None, alias='profa_20ord_alowq', description='증거금20%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20pred_reu_amt: str | None = Field(None, alias='profa_20pred_reu_amt', description='증거금20%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_20tdy_reu_amt: str | None = Field(None, alias='profa_20tdy_reu_amt', description='증거금20%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30ord_alow_amt: str | None = Field(None, alias='profa_30ord_alow_amt', description='증거금30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30ord_alowq: str | None = Field(None, alias='profa_30ord_alowq', description='증거금30%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30pred_reu_amt: str | None = Field(None, alias='profa_30pred_reu_amt', description='증거금30%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_30tdy_reu_amt: str | None = Field(None, alias='profa_30tdy_reu_amt', description='증거금30%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40ord_alow_amt: str | None = Field(None, alias='profa_40ord_alow_amt', description='증거금40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40ord_alowq: str | None = Field(None, alias='profa_40ord_alowq', description='증거금40%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40pred_reu_amt: str | None = Field(None, alias='profa_40pred_reu_amt', description='증거금40전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_40tdy_reu_amt: str | None = Field(None, alias='profa_40tdy_reu_amt', description='증거금40%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50ord_alow_amt: str | None = Field(None, alias='profa_50ord_alow_amt', description='증거금50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50ord_alowq: str | None = Field(None, alias='profa_50ord_alowq', description='증거금50%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50pred_reu_amt: str | None = Field(None, alias='profa_50pred_reu_amt', description='증거금50%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_50tdy_reu_amt: str | None = Field(None, alias='profa_50tdy_reu_amt', description='증거금50%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00011MarginCapacity60ToCashOnlyResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00011'
    profa_60ord_alow_amt: str | None = Field(None, alias='profa_60ord_alow_amt', description='증거금60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60ord_alowq: str | None = Field(None, alias='profa_60ord_alowq', description='증거금60%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60pred_reu_amt: str | None = Field(None, alias='profa_60pred_reu_amt', description='증거금60%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_60tdy_reu_amt: str | None = Field(None, alias='profa_60tdy_reu_amt', description='증거금60%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100ord_alow_amt: str | None = Field(None, alias='profa_100ord_alow_amt', description='증거금100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100ord_alowq: str | None = Field(None, alias='profa_100ord_alowq', description='증거금100%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100pred_reu_amt: str | None = Field(None, alias='profa_100pred_reu_amt', description='증거금100%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    profa_100tdy_reu_amt: str | None = Field(None, alias='profa_100tdy_reu_amt', description='증거금100%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_ord_alow_amt: str | None = Field(None, alias='min_ord_alow_amt', description='미수불가주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_ord_alowq: str | None = Field(None, alias='min_ord_alowq', description='미수불가주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_pred_reu_amt: str | None = Field(None, alias='min_pred_reu_amt', description='미수불가전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_tdy_reu_amt: str | None = Field(None, alias='min_tdy_reu_amt', description='미수불가금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00011AccountFundingResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00011'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_pos_repl: str | None = Field(None, alias='ord_pos_repl', description='주문가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00012GuaranteeRateResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00012'
    stk_assr_rt: str | None = Field(None, alias='stk_assr_rt', description='종목보증금율')
    stk_assr_rt_nm: str | None = Field(None, alias='stk_assr_rt_nm', description='종목보증금율명')


class Kt00012GuaranteeOrderCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00012'
    assr_30ord_alow_amt: str | None = Field(None, alias='assr_30ord_alow_amt', description='보증금30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_30ord_alowq: str | None = Field(None, alias='assr_30ord_alowq', description='보증금30%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_30pred_reu_amt: str | None = Field(None, alias='assr_30pred_reu_amt', description='보증금30%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_30tdy_reu_amt: str | None = Field(None, alias='assr_30tdy_reu_amt', description='보증금30%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40ord_alow_amt: str | None = Field(None, alias='assr_40ord_alow_amt', description='보증금40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40ord_alowq: str | None = Field(None, alias='assr_40ord_alowq', description='보증금40%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40pred_reu_amt: str | None = Field(None, alias='assr_40pred_reu_amt', description='보증금40%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_40tdy_reu_amt: str | None = Field(None, alias='assr_40tdy_reu_amt', description='보증금40%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50ord_alow_amt: str | None = Field(None, alias='assr_50ord_alow_amt', description='보증금50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50ord_alowq: str | None = Field(None, alias='assr_50ord_alowq', description='보증금50%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50pred_reu_amt: str | None = Field(None, alias='assr_50pred_reu_amt', description='보증금50%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_50tdy_reu_amt: str | None = Field(None, alias='assr_50tdy_reu_amt', description='보증금50%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60ord_alow_amt: str | None = Field(None, alias='assr_60ord_alow_amt', description='보증금60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60ord_alowq: str | None = Field(None, alias='assr_60ord_alowq', description='보증금60%주문가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60pred_reu_amt: str | None = Field(None, alias='assr_60pred_reu_amt', description='보증금60%전일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    assr_60tdy_reu_amt: str | None = Field(None, alias='assr_60tdy_reu_amt', description='보증금60%금일재사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00012AccountAndReceivableCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00012'
    entr: str | None = Field(None, alias='entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    repl_amt: str | None = Field(None, alias='repl_amt', description='대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_pos_repl: str | None = Field(None, alias='ord_pos_repl', description='주문가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ord_alowa: str | None = Field(None, alias='ord_alowa', description='주문가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    out_alowa: str | None = Field(None, alias='out_alowa', description='미수가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    out_pos_qty: str | None = Field(None, alias='out_pos_qty', description='미수가능수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_amt: str | None = Field(None, alias='min_amt', description='미수불가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    min_qty: str | None = Field(None, alias='min_qty', description='미수불가수량 — 단위: 1주, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00013TodayReuseResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    tdy_reu_objt_amt: str | None = Field(None, alias='tdy_reu_objt_amt', description='금일재사용대상금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_use_amt: str | None = Field(None, alias='tdy_reu_use_amt', description='금일재사용사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_alowa: str | None = Field(None, alias='tdy_reu_alowa', description='금일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_lmtt_amt: str | None = Field(None, alias='tdy_reu_lmtt_amt', description='금일재사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_reu_alowa_fin: str | None = Field(None, alias='tdy_reu_alowa_fin', description='금일재사용가능금액최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013PreviousDayReuseResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    pred_reu_objt_amt: str | None = Field(None, alias='pred_reu_objt_amt', description='전일재사용대상금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_use_amt: str | None = Field(None, alias='pred_reu_use_amt', description='전일재사용사용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_alowa: str | None = Field(None, alias='pred_reu_alowa', description='전일재사용가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_lmtt_amt: str | None = Field(None, alias='pred_reu_lmtt_amt', description='전일재사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_reu_alowa_fin: str | None = Field(None, alias='pred_reu_alowa_fin', description='전일재사용가능금액최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013CashResourcesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    ch_amt: str | None = Field(None, alias='ch_amt', description='현금금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_profa: str | None = Field(None, alias='ch_profa', description='현금증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_ch: str | None = Field(None, alias='use_pos_ch', description='사용가능현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_use_lmtt_amt: str | None = Field(None, alias='ch_use_lmtt_amt', description='현금사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_ch_fin: str | None = Field(None, alias='use_pos_ch_fin', description='사용가능현금최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013SubstituteResourcesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    repl_amt_amt: str | None = Field(None, alias='repl_amt_amt', description='대용금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_profa: str | None = Field(None, alias='repl_profa', description='대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_repl: str | None = Field(None, alias='use_pos_repl', description='사용가능대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_use_lmtt_amt: str | None = Field(None, alias='repl_use_lmtt_amt', description='대용사용제한금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    use_pos_repl_fin: str | None = Field(None, alias='use_pos_repl_fin', description='사용가능대용최종 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013CreditAndLendingCollateralResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    crd_grnta_ch: str | None = Field(None, alias='crd_grnta_ch', description='신용보증금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnta_repl: str | None = Field(None, alias='crd_grnta_repl', description='신용보증금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_ch: str | None = Field(None, alias='crd_grnt_ch', description='신용담보금현금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_grnt_repl: str | None = Field(None, alias='crd_grnt_repl', description='신용담보금대용 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    uncla: str | None = Field(None, alias='uncla', description='미수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ls_grnt_reu_gold: str | None = Field(None, alias='ls_grnt_reu_gold', description='대주담보금재사용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013MarginOrderCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    f_20ord_alow_amt: str | None = Field(None, alias='20ord_alow_amt', description='20%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_30ord_alow_amt: str | None = Field(None, alias='30ord_alow_amt', description='30%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_40ord_alow_amt: str | None = Field(None, alias='40ord_alow_amt', description='40%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_50ord_alow_amt: str | None = Field(None, alias='50ord_alow_amt', description='50%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_60ord_alow_amt: str | None = Field(None, alias='60ord_alow_amt', description='60%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    f_100ord_alow_amt: str | None = Field(None, alias='100ord_alow_amt', description='100%주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013RepaymentLossesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    tdy_crd_rpya_loss_amt: str | None = Field(None, alias='tdy_crd_rpya_loss_amt', description='금일신용상환손실금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_crd_rpya_loss_amt: str | None = Field(None, alias='pred_crd_rpya_loss_amt', description='전일신용상환손실금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tdy_ls_rpya_loss_repl_profa: str | None = Field(None, alias='tdy_ls_rpya_loss_repl_profa', description='금일대주상환손실대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    pred_ls_rpya_loss_repl_profa: str | None = Field(None, alias='pred_ls_rpya_loss_repl_profa', description='전일대주상환손실대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013SubstituteValuationAndLimitsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    evlt_repl_amt_spg_use_skip: str | None = Field(None, alias='evlt_repl_amt_spg_use_skip', description='평가대용금(현물사용제외) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    evlt_repl_rt: str | None = Field(None, alias='evlt_repl_rt', description='평가대용비율 — 단위: %, 소수점 일곱번째 자리까지 포맷된 백분율')
    crd_repl_profa: str | None = Field(None, alias='crd_repl_profa', description='신용대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_ord_repl_profa: str | None = Field(None, alias='ch_ord_repl_profa', description='현금주문대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_ord_repl_profa: str | None = Field(None, alias='crd_ord_repl_profa', description='신용주문대용증거금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_repl_conv_gold: str | None = Field(None, alias='crd_repl_conv_gold', description='신용대용환산금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_alowa: str | None = Field(None, alias='repl_alowa', description='대용가능금액(현금제한) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    repl_alowa_2: str | None = Field(None, alias='repl_alowa_2', description='대용가능금액2(신용제한) — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_repl_lck_gold: str | None = Field(None, alias='ch_repl_lck_gold', description='현금대용부족금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_repl_lck_gold: str | None = Field(None, alias='crd_repl_lck_gold', description='신용대용부족금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    ch_ord_alow_repla: str | None = Field(None, alias='ch_ord_alow_repla', description='현금주문가능대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    crd_ord_alow_repla: str | None = Field(None, alias='crd_ord_alow_repla', description='신용주문가능대용금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00013D2FundingCapacityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00013'
    d2vexct_entr: str | None = Field(None, alias='d2vexct_entr', description='D2가정산예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    d2ch_ord_alow_amt: str | None = Field(None, alias='d2ch_ord_alow_amt', description='D2현금주문가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00016AccountManagerResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00016'
    mang_empno: str | None = Field(None, alias='mang_empno', description='관리사원번호')
    mngr_nm: str | None = Field(None, alias='mngr_nm', description='관리자명')
    dept_nm: str | None = Field(None, alias='dept_nm', description='관리자지점')


class Kt00016AssetBalanceChangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00016'
    entr_fr: str | None = Field(None, alias='entr_fr', description='예수금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    entr_to: str | None = Field(None, alias='entr_to', description='예수금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    scrt_evlt_amt_fr: str | None = Field(None, alias='scrt_evlt_amt_fr', description='유가증권평가금액_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    scrt_evlt_amt_to: str | None = Field(None, alias='scrt_evlt_amt_to', description='유가증권평가금액_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_grnt_fr: str | None = Field(None, alias='ls_grnt_fr', description='대주담보금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_grnt_to: str | None = Field(None, alias='ls_grnt_to', description='대주담보금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_fr: str | None = Field(None, alias='crd_loan_fr', description='신용융자금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_to: str | None = Field(None, alias='crd_loan_to', description='신용융자금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ch_uncla_fr: str | None = Field(None, alias='ch_uncla_fr', description='현금미수금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ch_uncla_to: str | None = Field(None, alias='ch_uncla_to', description='현금미수금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    krw_asgna_fr: str | None = Field(None, alias='krw_asgna_fr', description='원화대용금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    krw_asgna_to: str | None = Field(None, alias='krw_asgna_to', description='원화대용금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_evlta_fr: str | None = Field(None, alias='ls_evlta_fr', description='대주평가금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    ls_evlta_to: str | None = Field(None, alias='ls_evlta_to', description='대주평가금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rght_evlta_fr: str | None = Field(None, alias='rght_evlta_fr', description='권리평가금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rght_evlta_to: str | None = Field(None, alias='rght_evlta_to', description='권리평가금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00016LiabilityBalanceChangeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00016'
    loan_amt_fr: str | None = Field(None, alias='loan_amt_fr', description='대출금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    loan_amt_to: str | None = Field(None, alias='loan_amt_to', description='대출금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana_fr: str | None = Field(None, alias='etc_loana_fr', description='기타대여금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana_to: str | None = Field(None, alias='etc_loana_to', description='기타대여금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold_fr: str | None = Field(None, alias='crd_int_npay_gold_fr', description='신용이자미납금_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold_to: str | None = Field(None, alias='crd_int_npay_gold_to', description='신용이자미납금_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_fr: str | None = Field(None, alias='crd_int_fr', description='신용이자_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_to: str | None = Field(None, alias='crd_int_to', description='신용이자_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00016PerformanceSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00016'
    tot_amt_fr: str | None = Field(None, alias='tot_amt_fr', description='순자산액계_초 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_amt_to: str | None = Field(None, alias='tot_amt_to', description='순자산액계_말 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    invt_bsamt: str | None = Field(None, alias='invt_bsamt', description='투자원금평잔 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    evltv_prft: str | None = Field(None, alias='evltv_prft', description='평가손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    prft_rt: str | None = Field(None, alias='prft_rt', description='수익률 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    tern_rt: str | None = Field(None, alias='tern_rt', description='회전율 — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')


class Kt00016PeriodFlowsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00016'
    termin_tot_trns: str | None = Field(None, alias='termin_tot_trns', description='기간내총입금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    termin_tot_pymn: str | None = Field(None, alias='termin_tot_pymn', description='기간내총출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    termin_tot_inq: str | None = Field(None, alias='termin_tot_inq', description='기간내총입고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    termin_tot_outq: str | None = Field(None, alias='termin_tot_outq', description='기간내총출고 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    futr_repl_sella: str | None = Field(None, alias='futr_repl_sella', description='선물대용매도금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    trst_repl_sella: str | None = Field(None, alias='trst_repl_sella', description='위탁대용매도금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00017D2AccountPositionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00017'
    d2_entra: str | None = Field(None, alias='d2_entra', description='D+2추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_npay_gold: str | None = Field(None, alias='crd_int_npay_gold', description='신용이자미납금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    etc_loana: str | None = Field(None, alias='etc_loana', description='기타대여금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    gnrl_stk_evlt_amt_d2: str | None = Field(None, alias='gnrl_stk_evlt_amt_d2', description='일반주식평가금액D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    dpst_grnt_use_amt_d2: str | None = Field(None, alias='dpst_grnt_use_amt_d2', description='예탁담보대출금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_stk_evlt_amt_d2: str | None = Field(None, alias='crd_stk_evlt_amt_d2', description='예탁담보주식평가금액D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_d2: str | None = Field(None, alias='crd_loan_d2', description='신용융자금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_loan_evlta_d2: str | None = Field(None, alias='crd_loan_evlta_d2', description='신용융자평가금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_ls_grnt_d2: str | None = Field(None, alias='crd_ls_grnt_d2', description='신용대주담보금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_ls_evlta_d2: str | None = Field(None, alias='crd_ls_evlta_d2', description='신용대주평가금D+2 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00017DailyCashAndTradingFlowsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00017'
    ina_amt: str | None = Field(None, alias='ina_amt', description='입금금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    outa: str | None = Field(None, alias='outa', description='출금금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    inq_amt: str | None = Field(None, alias='inq_amt', description='입고금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    outq_amt: str | None = Field(None, alias='outq_amt', description='출고금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    sell_amt: str | None = Field(None, alias='sell_amt', description='매도금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    buy_amt: str | None = Field(None, alias='buy_amt', description='매수금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    cmsn: str | None = Field(None, alias='cmsn', description='수수료 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tax: str | None = Field(None, alias='tax', description='세금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00017OtherAssetsAndIncomeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00017'
    stk_pur_cptal_loan_amt: str | None = Field(None, alias='stk_pur_cptal_loan_amt', description='주식매입자금대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    rp_evlt_amt: str | None = Field(None, alias='rp_evlt_amt', description='RP평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    bd_evlt_amt: str | None = Field(None, alias='bd_evlt_amt', description='채권평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    elsevlt_amt: str | None = Field(None, alias='elsevlt_amt', description='ELS평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    crd_int_amt: str | None = Field(None, alias='crd_int_amt', description='신용이자금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    sel_prica_grnt_loan_int_amt_amt: str | None = Field(None, alias='sel_prica_grnt_loan_int_amt_amt', description='매도대금담보대출이자금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    dvida_amt: str | None = Field(None, alias='dvida_amt', description='배당금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt00018PortfolioSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00018'
    tot_pur_amt: str | None = Field(None, alias='tot_pur_amt', description='총매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_evlt_amt: str | None = Field(None, alias='tot_evlt_amt', description='총평가금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_evlt_pl: str | None = Field(None, alias='tot_evlt_pl', description='총평가손익금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_prft_rt: str | None = Field(None, alias='tot_prft_rt', description='총수익률(%) — 단위: %, 소수점 둘째 자리까지 포맷된 백분율')
    prsm_dpst_aset_amt: str | None = Field(None, alias='prsm_dpst_aset_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00018FinancingSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00018'
    tot_loan_amt: str | None = Field(None, alias='tot_loan_amt', description='총대출금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_crd_loan_amt: str | None = Field(None, alias='tot_crd_loan_amt', description='총융자금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')
    tot_crd_ls_amt: str | None = Field(None, alias='tot_crd_ls_amt', description='총대주금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 15자리 숫자')


class Kt00018HoldingsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt00018'
    acnt_evlt_remn_indv_tot: list[Kt00018ResponseAcntEvltRemnIndvTotItem] = Field(default_factory=list, alias='acnt_evlt_remn_indv_tot', description='계좌평가잔고개별합산')


class Kt50020GoldAccountSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50020'
    tot_entr: str | None = Field(None, alias='tot_entr', description='예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    net_entr: str | None = Field(None, alias='net_entr', description='추정예수금 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_est_amt: str | None = Field(None, alias='tot_est_amt', description='잔고평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    net_amt: str | None = Field(None, alias='net_amt', description='예탁자산평가액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_book_amt2: str | None = Field(None, alias='tot_book_amt2', description='총매입금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    tot_dep_amt: str | None = Field(None, alias='tot_dep_amt', description='추정예탁자산 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    paym_alowa: str | None = Field(None, alias='paym_alowa', description='출금가능금액 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')
    pl_amt: str | None = Field(None, alias='pl_amt', description='실현손익 — 단위: 원, 좌측 0-padding 처리된 부호 포함 12자리 숫자')


class Kt50020GoldHoldingsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50020'
    gold_acnt_evlt_prst: list[Kt50020ResponseGoldAcntEvltPrstItem] = Field(default_factory=list, alias='gold_acnt_evlt_prst', description='금현물계좌평가현황')


class Kt50032AccountIdentityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50032'
    acnt_print: str | None = Field(None, alias='acnt_print', description='계좌번호 — 계좌번호 출력용')


class Kt50032GoldTradeHistoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    tr_id: ClassVar[str] = 'kt50032'
    gold_trde_hist: list[Kt50032ResponseGoldTrdeHistItem] = Field(default_factory=list, alias='gold_trde_hist', description='금현물거래내역')

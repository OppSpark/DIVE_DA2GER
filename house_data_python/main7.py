import pandas as pd

# CSV 파일을 읽어옵니다.
try:
    df = pd.read_csv('jeonse_data_with_gps.csv', encoding='utf-8')
except (UnicodeDecodeError, FileNotFoundError):
    df = pd.read_csv('jeonse_data_with_gps.csv', encoding='cp949')

# --- 1. '보증금(만원)' 열을 원 단위로 변경하고 콤마 제거 ---
# 콤마를 제거하고 숫자형으로 변환한 뒤 10000을 곱합니다.
df['보증금(원)'] = pd.to_numeric(
    df['보증금(만원)'].astype(str).str.replace(',', ''), 
    errors='coerce'
) * 10000

# 기존 '보증금(만원)' 열은 삭제합니다.
df = df.drop(columns=['보증금(만원)'])

# --- 2. 지정된 열들을 정수형으로 변환 ---
# 정수형으로 변환할 열 목록
cols_to_convert = [
    '계약년월',
    '보증금(원)',
    '층',
    '건축년도',
    '주택매매가격(원)',
    '공시지가(원)'
]

for col in cols_to_convert:
    # 먼저 숫자형으로 바꾸고 (빈 문자열 등은 NaN으로 처리)
    df[col] = pd.to_numeric(df[col], errors='coerce')
    # NaN 값을 유지하면서 정수로 변환 (소수점 .0 제거)
    df[col] = df[col].astype('Int64')

# --- 3. 최종 CSV 파일로 저장 ---
df.to_csv('final.csv', index=False, encoding='utf-8-sig')

print("작업이 완료되었습니다. final.csv 파일을 확인해주세요.")
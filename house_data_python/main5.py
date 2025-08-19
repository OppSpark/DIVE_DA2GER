import pandas as pd

# CSV 파일을 읽어옵니다.
try:
    df = pd.read_csv('jeonse_data_final_cleaned.csv', encoding='utf-8')
except (UnicodeDecodeError, FileNotFoundError):
    df = pd.read_csv('jeonse_data_final_cleaned.csv', encoding='cp949')

# --- 1. 주택매매가격(만원) 단위를 원 단위로 변경 ---
# 먼저, 컬럼을 숫자형(float)으로 변환하여 계산을 준비합니다.
df['주택매매가격(만원)'] = pd.to_numeric(df['주택매매가격(만원)'], errors='coerce')

# 원 단위로 변환한 새 컬럼 생성
df['주택매매가격(원)'] = df['주택매매가격(만원)'] * 10000

# --- 2. 공시지가(원) 열 추가 ---
# 주택매매가격(원)의 68%로 공시지가를 계산
df['공시지가(원)'] = df['주택매매가격(원)'] * 0.68

# --- 3. 소수점(.0) 제거 및 빈 값(NaN) 처리 ---
# 숫자를 정수형 문자열로 바꾸고, 빈 값은 그대로 비워두는 함수
def format_as_int_or_empty(value):
    if pd.isna(value):
        return '' # NaN 값은 빈 문자열로 처리
    return str(int(value)) # 소수점을 버리고 정수형 문자열로 변환

df['주택매매가격(원)'] = df['주택매매가격(원)'].apply(format_as_int_or_empty)
df['공시지가(원)'] = df['공시지가(원)'].apply(format_as_int_or_empty)

# --- 4. 최종 데이터 정리 및 저장 ---
# 기존 '만원' 단위 컬럼 삭제
df_final = df.drop(columns=['주택매매가격(만원)'])

# 최종 CSV 파일로 저장
df_final.to_csv('jeonse_data_final_with_gongsi.csv', index=False, encoding='utf-8-sig')

print("작업이 완료되었습니다. jeonse_data_final_with_gongsi.csv 파일을 확인해주세요.")
import pandas as pd

# 데이터 파일을 읽어옵니다.
try:
    df = pd.read_csv('jeonse_data2_matched_only.csv', encoding='utf-8')
except UnicodeDecodeError:
    df = pd.read_csv('jeonse_data2_matched_only.csv', encoding='cp949')

# 삭제할 컬럼 목록을 정확한 이름으로 지정합니다.
columns_to_delete = [
    '계약구분',
    '갱신요구권 사용',
    '종전계약 월세(만원)',
    '건물명',
    '도로조건',
    '계약면적(㎡)',
    '종전계약 보증금(만원)',
    '월세금(만원)',
    '계약일'
]

# 지정된 컬럼들을 삭제합니다. 
# errors='ignore'는 혹시 파일에 해당 컬럼명이 없더라도 오류 없이 실행되게 합니다.
df_cleaned = df.drop(columns=columns_to_delete, errors='ignore')

# 결과를 새로운 CSV 파일로 저장합니다.
df_cleaned.to_csv('jeonse_data_final_cleaned.csv', index=False, encoding='utf-8-sig')

print("요청하신 컬럼이 삭제된 파일이 jeonse_data_final_cleaned.csv 로 저장되었습니다.")
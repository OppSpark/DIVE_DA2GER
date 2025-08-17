import pandas as pd

# 데이터 파일 목록
files = [
    '아파트(전월세)_실거래가_20250817231300.csv',
    '연립다세대(전월세)_실거래가_20250817231354.csv',
    '단독다가구(전월세)_실거래가_20250817231412.csv',
    '오피스텔(전월세)_실거래가_20250817231426.csv'
]

# 데이터프레임을 저장할 리스트
df_list = []

# 각 파일을 순회하며 데이터프레임으로 읽어오기
for file in files:
    try:
        # utf-8으로 먼저 읽기를 시도
        df = pd.read_csv(file, skiprows=15, encoding='utf-8')
        df_list.append(df)
    except UnicodeDecodeError:
        # utf-8 읽기 실패 시 cp949로 재시도
        df = pd.read_csv(file, skiprows=15, encoding='cp949')
        df_list.append(df)


# 모든 데이터프레임을 하나로 합치기
combined_df = pd.concat(df_list, ignore_index=True)

# '전월세구분'이 '전세'인 데이터만 필터링
jeonse_df = combined_df[combined_df['전월세구분'] == '전세'].copy()

# '시군구'와 '도로명'을 합쳐서 전체 주소 생성.
# '도로명'이 없는 경우를 대비하여, fillna('')를 사용하여 NaN값을 빈 문자열로 대체
jeonse_df['전체주소'] = jeonse_df['시군구'].fillna('') + ' ' + jeonse_df['도로명'].fillna('')

# 주소를 기준으로 중복된 데이터 제거
unique_jeonse_df = jeonse_df.drop_duplicates(subset=['전체주소'])

# 결과를 CSV 파일로 저장
unique_jeonse_df.to_csv('jeonse_data.csv', index=False, encoding='utf-8-sig')

print("데이터 처리 및 저장이 완료되었습니다. jeonse_data.csv 파일을 확인해주세요.")
print(unique_jeonse_df.head())
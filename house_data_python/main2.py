import pandas as pd

# CSV 파일을 인코딩 문제없이 읽어오는 함수
def read_csv_with_fallback(file_path, skip_rows=0):
    try:
        # utf-8으로 먼저 읽기를 시도
        return pd.read_csv(file_path, skiprows=skip_rows, encoding='utf-8')
    except (UnicodeDecodeError, FileNotFoundError):
        # 실패 시 cp949로 재시도
        return pd.read_csv(file_path, skiprows=skip_rows, encoding='cp949')

# --- 1. jeonse_data.csv 파일 불러오기 ---
jeonse_df = read_csv_with_fallback('jeonse_data.csv')

# --- 2. 매매(Sale) 데이터 처리 ---
maemae_files = [
    '아파트(매매)_실거래가_20250817233449.csv',
    '연립다세대(매매)_실거래가_20250817233528.csv',
    '단독다가구(매매)_실거래가_20250817233539.csv',
    '오피스텔(매매)_실거래가_20250817233543.csv'
]
maemae_df_list = [read_csv_with_fallback(path, skip_rows=15) for path in maemae_files]
maemae_combined_df = pd.concat(maemae_df_list, ignore_index=True)

# 주소 키 생성 (도로명이 없는 경우를 대비하여 공백 처리)
maemae_combined_df['도로명'] = maemae_combined_df['도로명'].fillna('')
maemae_combined_df['전체주소'] = maemae_combined_df['시군구'].fillna('') + ' ' + maemae_combined_df['도로명']

# 거래금액을 숫자로 변환
maemae_combined_df['거래금액(만원)'] = pd.to_numeric(maemae_combined_df['거래금액(만원)'].astype(str).str.replace(',', ''), errors='coerce')

# 최신순으로 정렬
maemae_combined_df.sort_values(by=['계약년월', '계약일'], ascending=[False, False], inplace=True)

# 가장 최신 거래만 남기고 주소 기준 중복 제거
maemae_final_df = maemae_combined_df.drop_duplicates(subset=['전체주소'], keep='first')


# --- 3. jeonse_data와 매매 데이터 병합 ---
merged_df = pd.merge(
    jeonse_df,
    maemae_final_df[['전체주소', '거래금액(만원)']],
    on='전체주소',
    how='left'
)

# 추가된 매매가격 컬럼 이름 변경
merged_df.rename(columns={'거래금액(만원)': '주택매매가격(만원)'}, inplace=True)


# --- 4. jeonse_data2.csv 파일로 저장 ---
merged_df.to_csv('jeonse_data2.csv', index=False, encoding='utf-8-sig')

print(f"파일 생성이 완료되었습니다. jeonse_data2.csv 파일을 확인해주세요.")
print(f"총 {len(merged_df)}개의 전세 데이터 중 {merged_df['주택매매가격(만원)'].notna().sum()}개의 매칭되는 매매 데이터를 찾아 추가했습니다.")
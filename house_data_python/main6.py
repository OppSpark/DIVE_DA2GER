import pandas as pd
import requests
import time

# --- 1. 데이터 불러오기 ---
try:
    df = pd.read_csv('jeonse_data_final_with_gongsi.csv', encoding='utf-8')
except FileNotFoundError:
    df = pd.read_csv('jeonse_data_final_with_gongsi.csv', encoding='cp949')

# --- 2. 카카오 API 설정 ---
# ※※※※※ 본인의 REST API 키를 여기에 입력하세요 ※※※※※
KAKAO_API_KEY = '키 입력해'
api_url = 'https://dapi.kakao.com/v2/local/search/address.json'

# --- 3. 주소를 좌표로 변환하는 함수 정의 ---
def get_coords_from_address(address):
    headers = {'Authorization': f'KakaoAK {KAKAO_API_KEY}'}
    params = {'query': address}
    try:
        response = requests.get(api_url, headers=headers, params=params)
        response.raise_for_status() # 오류가 있으면 예외 발생
        json_data = response.json()
        
        # 주소 검색 결과가 있으면 첫 번째 결과의 좌표를 반환
        if json_data.get('documents'):
            first_result = json_data['documents'][0]
            # 카카오는 경도(longitude)가 x, 위도(latitude)가 y 입니다.
            return (first_result['y'], first_result['x'])
        else:
            return (None, None) # 결과가 없으면 None 반환
            
    except requests.exceptions.RequestException as e:
        print(f"API 요청 중 에러 발생: {e}")
        return (None, None)

# --- 4. 데이터프레임의 모든 주소에 대해 좌표 변환 실행 ---
latitudes = []  # 위도
longitudes = [] # 경도

for index, row in df.iterrows():
    address = row['전체주소']
    lat, lon = get_coords_from_address(address)
    
    latitudes.append(lat)
    longitudes.append(lon)
    
    # API에 너무 많은 요청을 한 번에 보내지 않도록 잠시 대기
    if (index + 1) % 10 == 0:
        print(f"{index + 1}개 주소 처리 완료...")
        time.sleep(0.1)

# --- 5. 결과 저장 ---
df['위도'] = latitudes
df['경도'] = longitudes

# 좌표가 추가된 최종 파일을 저장
df.to_csv('jeonse_data_with_gps.csv', index=False, encoding='utf-8-sig')

print("모든 주소의 좌표 변환이 완료되었습니다!")
print("jeonse_data_with_gps.csv 파일을 확인해주세요.")
print(df[['전체주소', '위도', '경도']].head())
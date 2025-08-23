import pandas as pd
import requests
import time
import json

# --- 1. CSV 파일 불러오기 ---
try:
    df = pd.read_csv('정비사업 추진현황 조회.csv', encoding='utf-8')
except UnicodeDecodeError:
    df = pd.read_csv('정비사업 추진현황 조회.csv', encoding='cp949')

# --- 2. 카카오 API 설정 ---
# ※※※※※ 본인의 REST API 키를 여기에 입력하세요 ※※※※※
KAKAO_API_KEY = '4da73d2bf653e995ba420706750d2971'
api_url = 'https://dapi.kakao.com/v2/local/search/address.json'

# --- 3. 주소를 좌표로 변환하는 함수 ---
def get_coords_from_address(address):
    headers = {'Authorization': f'KakaoAK {KAKAO_API_KEY}'}
    params = {'query': address}
    try:
        response = requests.get(api_url, headers=headers, params=params)
        response.raise_for_status() # 오류 발생 시 예외 처리
        json_data = response.json()
        
        if json_data.get('documents'):
            first_result = json_data['documents'][0]
            # 위도(latitude)는 'y', 경도(longitude)는 'x' 입니다.
            return (float(first_result['y']), float(first_result['x']))
        else:
            return (None, None)
            
    except requests.exceptions.RequestException as e:
        # 401 에러가 여기서 잡힙니다.
        print(f"'{address}' 주소 변환 중 에러 발생: {e}")
        return (None, None)

# --- 4. 데이터 변환 및 JSON 생성 ---
redevelopment_data = []
df.dropna(subset=['위치', '구역명'], inplace=True) # 필수 정보 없는 행 제거

for index, row in df.iterrows():
    address = row['위치']
    lat, lng = get_coords_from_address(address)
    
    # 좌표 변환에 성공한 경우에만 데이터 추가
    if lat and lng:
        redevelopment_data.append({
            'name': row.get('구역명'),
            'address': address,
            'stage': row.get('사업추진단계'),
            'builder': row.get('시공자'),
            'units': row.get('세대수'),
            'image_url': row.get('조감도 이미지 파일경로'),
            '위도': lat,
            '경도': lng
        })
    
    # API 요청 제한을 피하기 위해 잠시 대기
    time.sleep(0.05)
    if (index + 1) % 20 == 0:
        print(f"{index + 1}개 처리 완료...")


# --- 5. JSON 파일로 최종 저장 ---
with open('redevelopment_data.json', 'w', encoding='utf-8') as f:
    json.dump(redevelopment_data, f, ensure_ascii=False, indent=4)

print("\n--- 작업 완료 ---")
print(f"총 {len(df)}개의 데이터 중 {len(redevelopment_data)}개의 좌표를 성공적으로 변환했습니다.")
print("redevelopment_data.json 파일이 생성되었습니다.")
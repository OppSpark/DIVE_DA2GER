import requests
import json
import time
import math

def get_redevelopment_data(sw_lat, sw_lng, ne_lat, ne_lng):
    """
    주어진 좌표 영역 내의 재개발 데이터를 서버에 요청하고 JSON으로 반환합니다.
    """
    base_url = "https://www.jjmap.co.kr/proc/item.proc.php"
    params = {
        'type': 'select_v3',
        'nelat': ne_lat,
        'nelng': ne_lng,
        'swlat': sw_lat,
        'swlng': sw_lng
    }
    try:
        # User-Agent를 설정하여 일반적인 브라우저 요청처럼 보이게 합니다.
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(base_url, params=params, headers=headers, timeout=15)
        response.raise_for_status()  # HTTP 오류가 발생하면 예외를 발생시킵니다.
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"오류 발생 (Lat: {sw_lat}, Lng: {sw_lng}): {e}")
        return None

def main():
    """
    부산시 전체를 격자로 나누어 재개발 데이터를 수집하고 JSON 파일로 저장합니다.
    """
    print("부산시 전체 재개발 구역 데이터 추출을 시작합니다.")

    # 1. 부산시 전체를 포괄하는 경계 좌표 설정 (약간의 여유를 둠)
    # 남서쪽(South-West) 좌표
    busan_sw_lat = 34.98
    busan_sw_lng = 128.75
    # 북동쪽(North-East) 좌표
    busan_ne_lat = 35.40
    busan_ne_lng = 129.30

    # 2. 격자 크기(step) 설정 (값이 작을수록 정밀하지만 요청 횟수가 늘어남)
    step = 0.02

    all_areas = {} # 중복 제거를 위해 딕셔너리 사용 (key: area_idx)

    # 3. 격자를 순회하며 데이터 요청
    lat_steps = math.ceil((busan_ne_lat - busan_sw_lat) / step)
    lng_steps = math.ceil((busan_ne_lng - busan_sw_lng) / step)
    total_steps = lat_steps * lng_steps
    current_step = 0

    for i in range(lat_steps):
        for j in range(lng_steps):
            current_step += 1
            sw_lat = busan_sw_lat + i * step
            sw_lng = busan_sw_lng + j * step
            ne_lat = sw_lat + step
            ne_lng = sw_lng + step

            progress = (current_step / total_steps) * 100
            print(f"진행률: {progress:.2f}% ({current_step}/{total_steps}) - 현재 타일 요청 중: ({sw_lat:.4f}, {sw_lng:.4f})")

            data = get_redevelopment_data(sw_lat, sw_lng, ne_lat, ne_lng)

            if data and data.get('result') == 'ok' and 'data' in data:
                # 4. 데이터 추출 및 중복 제거
                for area in data['data']:
                    area_idx = area.get('idx')
                    # 고유 ID가 있고, 아직 저장되지 않은 구역인 경우에만 추가
                    if area_idx and area_idx not in all_areas:
                        
                        # 필요한 정보만 추출하여 재구성
                        coordinates = area.get('0', {}).get('coord', [])
                        
                        if coordinates: # 좌표 데이터가 있는 경우에만 저장
                            formatted_area = {
                                "id": area.get('idx'),
                                "name": area.get('name'),
                                "area_status": area.get('area_status'),
                                "center_coord": area.get('centerCoord'),
                                "coordinates": coordinates
                            }
                            all_areas[area_idx] = formatted_area
            
            # 서버에 과도한 부하를 주지 않기 위해 요청 사이에 짧은 딜레이 추가
            time.sleep(0.5)

    # 5. 최종 결과를 리스트 형태로 변환하여 JSON 파일로 저장
    final_data = list(all_areas.values())
    
    output_filename = 'busan_redevelopment_areas.json'
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            # ensure_ascii=False로 설정하여 한글이 깨지지 않게 저장
            # indent=4로 설정하여 가독성 좋은 포맷으로 저장
            json.dump(final_data, f, ensure_ascii=False, indent=4)
        print(f"\n✅ 데이터 추출 완료! 총 {len(final_data)}개의 고유한 재개발 구역 정보를 '{output_filename}' 파일에 저장했습니다.")
    except IOError as e:
        print(f"\n❌ 파일 저장 중 오류가 발생했습니다: {e}")


if __name__ == '__main__':
    main()
import pandas as pd
import json

# CSV 파일을 읽어옵니다.
try:
    df = pd.read_csv('final.csv', encoding='utf-8')
except (UnicodeDecodeError, FileNotFoundError):
    df = pd.read_csv('final.csv', encoding='cp949')

# 데이터프레임을 JSON 형식의 문자열로 변환합니다.
# orient='records'는 [{컬럼1: 값1}, {컬럼2: 값2}, ...] 형태의 리스트로 만들어줍니다.
json_data = df.to_json(orient='records', indent=4, force_ascii=False)

# JSON 문자열을 파일에 저장합니다.
with open('jeonse_data.json', 'w', encoding='utf-8') as f:
    f.write(json_data)

print("CSV 파일이 JSON 형식으로 성공적으로 변환되었습니다.")
print("jeonse_data.json 파일을 확인해주세요.")
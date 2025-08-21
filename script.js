class MealService {
    constructor() {
        this.baseURL = 'https://open.neis.go.kr/hub/mealServiceDietInfo';
        this.schoolCode = {
            ATPT_OFCDC_SC_CODE: 'J10',
            SD_SCHUL_CODE: '7530475'
        };
        this.initializeEventListeners();
        this.setTodayDate();
    }

    initializeEventListeners() {
        const searchBtn = document.getElementById('searchBtn');
        const dateInput = document.getElementById('dateInput');

        searchBtn.addEventListener('click', () => this.searchMeal());
        dateInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchMeal();
            }
        });
    }

    setTodayDate() {
        const today = new Date();
        const dateString = today.toISOString().split('T')[0];
        document.getElementById('dateInput').value = dateString;
    }

    async searchMeal() {
        const dateInput = document.getElementById('dateInput');
        const selectedDate = dateInput.value;

        if (!selectedDate) {
            alert('날짜를 선택해주세요.');
            return;
        }

        const formattedDate = selectedDate.replace(/-/g, '');

        this.showLoading();
        this.hideError();
        this.hideMealInfo();

        try {
            const mealData = await this.fetchMealData(formattedDate);
            this.displayMealInfo(mealData, selectedDate);
        } catch (error) {
            console.error('급식 정보 조회 중 오류:', error);
            let errorMessage = '해당 날짜의 급식 정보를 찾을 수 없습니다.';

            if (error.message.includes('해당하는 데이터가 없습니다')) {
                errorMessage = '선택하신 날짜에는 급식이 제공되지 않습니다.';
            } else if (error.message.includes('프록시 서비스')) {
                errorMessage = '네트워크 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.';
            }

            this.showError(errorMessage);
        } finally {
            this.hideLoading();
        }
    }

    async fetchMealData(date) {
        const url = `${this.baseURL}?ATPT_OFCDC_SC_CODE=${this.schoolCode.ATPT_OFCDC_SC_CODE}&SD_SCHUL_CODE=${this.schoolCode.SD_SCHUL_CODE}&MLSV_YMD=${date}&Type=xml`;

        try {
            // 여러 프록시 서비스 시도
            const proxyServices = [
                'https://api.allorigins.win/raw?url=',
                'https://corsproxy.io/?',
                'https://cors-anywhere.herokuapp.com/'
            ];

            for (const proxy of proxyServices) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(url), {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/xml, text/xml, */*',
                        },
                        mode: 'cors'
                    });

                    if (response.ok) {
                        const xmlText = await response.text();
                        console.log('API 응답:', xmlText); // 디버깅용
                        return this.parseXMLData(xmlText);
                    }
                } catch (error) {
                    console.log(`${proxy} 실패:`, error);
                    continue;
                }
            }

            throw new Error('모든 프록시 서비스에서 실패했습니다.');

        } catch (error) {
            console.error('API 호출 오류:', error);
            throw error;
        }
    }

    parseXMLData(xmlText) {
        console.log('받은 XML 데이터:', xmlText); // 디버깅용

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // 에러 체크
        const errorElement = xmlDoc.querySelector('parsererror');
        if (errorElement) {
            console.error('XML 파싱 오류:', errorElement.textContent);
            throw new Error('XML 파싱 오류');
        }

        // NEIS API 에러 응답 체크
        const result = xmlDoc.querySelector('RESULT');
        if (result) {
            const code = result.querySelector('CODE')?.textContent;
            const message = result.querySelector('MESSAGE')?.textContent;
            if (code && code !== 'INFO-000') {
                console.error('NEIS API 오류:', code, message);
                throw new Error(message || '해당 날짜의 급식 정보가 없습니다.');
            }
        }

        const rows = xmlDoc.querySelectorAll('row');
        console.log('찾은 row 개수:', rows.length); // 디버깅용

        if (rows.length === 0) {
            throw new Error('해당 날짜의 급식 정보가 없습니다.');
        }

        const mealData = {
            breakfast: { dishes: [], calories: 0 },
            lunch: { dishes: [], calories: 0 },
            dinner: { dishes: [], calories: 0 },
            totalCalories: 0,
            nutritionInfo: null
        };

        rows.forEach((row, index) => {
            const mealType = row.querySelector('MMEAL_SC_NM')?.textContent;
            const dishName = row.querySelector('DDISH_NM')?.textContent;

            // ✅ 수정된 부분: CAL_INFO에서 칼로리 정보를 직접 파싱합니다.
            const calInfoNode = row.querySelector('CAL_INFO');
            let calories = 0;
            let calInfo = '';

            if (calInfoNode) {
                // CDATA 포함 전체 텍스트를 가져옵니다.
                calInfo = calInfoNode.textContent.trim();
                // 정규식을 사용하여 "1058.9 Kcal" 같은 문자열에서 숫자 부분만 추출합니다.
                const calorieMatch = calInfo.match(/([0-9.]+)\s*Kcal/i);
                if (calorieMatch) {
                    calories = parseFloat(calorieMatch[1]) || 0;
                }
            }

            console.log(`Row ${index}:`, mealType, dishName, `${calories}kcal`);
            if (calInfo && calInfo !== '') {
                console.log(`영양소 정보:`, calInfo);
            }

            if (dishName) {
                // 알레르기 정보 제거 및 메뉴 분리
                const dishes = dishName
                    .replace(/\([^)]*\)/g, '') // 괄호와 그 안의 내용 제거 (알레르기 정보)
                    .split('<br/>')
                    .map(dish => dish.replace(/\d+\./g, '').trim())
                    .filter(dish => dish.length > 0);

                // CAL_INFO에서 영양소 정보 파싱 시도
                if (calInfo && !mealData.nutritionInfo) {
                    mealData.nutritionInfo = this.parseNutritionInfo(calInfo);
                }

                switch (mealType) {
                    case '조식':
                        mealData.breakfast.dishes.push(...dishes);
                        mealData.breakfast.calories = calories;
                        break;
                    case '중식':
                        mealData.lunch.dishes.push(...dishes);
                        mealData.lunch.calories = calories;
                        break;
                    case '석식':
                        mealData.dinner.dishes.push(...dishes);
                        mealData.dinner.calories = calories;
                        break;
                }
            }
        });

        // 총 칼로리 계산
        mealData.totalCalories = mealData.breakfast.calories + mealData.lunch.calories + mealData.dinner.calories;

        console.log('파싱된 급식 데이터:', mealData); // 디버깅용
        return mealData;
    }

    displayMealInfo(mealData, date) {
        const mealDateElement = document.getElementById('mealDate');
        const breakfastElement = document.getElementById('breakfast');
        const lunchElement = document.getElementById('lunch');
        const dinnerElement = document.getElementById('dinner');

        // 날짜 표시
        const formattedDate = this.formatDate(date);
        mealDateElement.innerHTML = `
            ${formattedDate} 급식 정보
            <div class="nutrition-summary">
                <div class="total-calories">총 칼로리: ${mealData.totalCalories.toFixed(1)}kcal</div>
                ${this.generateNutritionChart(mealData.totalCalories, mealData.nutritionInfo)}
            </div>
        `;

        // 각 식사 정보 표시
        this.renderMealSection(breakfastElement, mealData.breakfast, '조식');
        this.renderMealSection(lunchElement, mealData.lunch, '중식');
        this.renderMealSection(dinnerElement, mealData.dinner, '석식');

        this.showMealInfo();
    }

    renderMealSection(element, mealInfo, mealType) {
        element.innerHTML = '';

        if (mealInfo.dishes.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.textContent = '급식 정보가 없습니다.';
            emptyItem.className = 'empty-meal';
            element.appendChild(emptyItem);
        } else {
            // 칼로리 정보 표시
            if (mealInfo.calories > 0) {
                const calorieItem = document.createElement('li');
                calorieItem.innerHTML = `<strong>칼로리: ${mealInfo.calories}kcal</strong>`;
                calorieItem.className = 'calorie-info';
                element.appendChild(calorieItem);
            }

            // 메뉴 표시
            mealInfo.dishes.forEach(meal => {
                const listItem = document.createElement('li');
                listItem.textContent = meal;
                element.appendChild(listItem);
            });
        }
    }

    parseNutritionInfo(calInfo) {
        if (!calInfo || calInfo.trim() === '') {
            return null;
        }

        try {
            // 칼로리 숫자만 있는 경우 대응 (예: "833.9 Kcal")
            const kcalMatch = calInfo.match(/([0-9.]+)\s*Kcal/i);
            if (kcalMatch && !calInfo.includes('탄수화물')) {
                return null; // 숫자만 있으면 영양소 비율 없음
            }

            // 탄수화물, 단백질, 지방 정보 추출
            const carbMatch = calInfo.match(/탄수화물[:\s]*([0-9.]+)/);
            const proteinMatch = calInfo.match(/단백질[:\s]*([0-9.]+)/);
            const fatMatch = calInfo.match(/지방[:\s]*([0-9.]+)/);

            if (carbMatch || proteinMatch || fatMatch) {
                const carbs = carbMatch ? parseFloat(carbMatch[1]) : 0;
                const protein = proteinMatch ? parseFloat(proteinMatch[1]) : 0;
                const fat = fatMatch ? parseFloat(fatMatch[1]) : 0;

                const total = carbs * 4 + protein * 4 + fat * 9;

                if (total > 0) {
                    return {
                        carbs: Math.round((carbs * 4 / total) * 100),
                        protein: Math.round((protein * 4 / total) * 100),
                        fat: Math.round((fat * 9 / total) * 100)
                    };
                }
            }
        } catch (error) {
            console.log('영양소 정보 파싱 오류:', error);
        }

        return null;
    }

    generateNutritionChart(totalCalories, nutritionInfo = null) {
        let carbPercentage, proteinPercentage, fatPercentage;

        if (nutritionInfo) {
            carbPercentage = nutritionInfo.carbs;
            proteinPercentage = nutritionInfo.protein;
            fatPercentage = nutritionInfo.fat;
            console.log('실제 영양소 비율 사용:', nutritionInfo);
        } else {
            if (totalCalories >= 900) {
                carbPercentage = 55 + Math.random() * 10;
                proteinPercentage = 15 + Math.random() * 10;
                fatPercentage = 100 - carbPercentage - proteinPercentage;
            } else if (totalCalories >= 600) {
                carbPercentage = 60 + Math.random() * 8;
                proteinPercentage = 12 + Math.random() * 8;
                fatPercentage = 100 - carbPercentage - proteinPercentage;
            } else if (totalCalories > 0) {
                carbPercentage = 45 + Math.random() * 10;
                proteinPercentage = 20 + Math.random() * 10;
                fatPercentage = 100 - carbPercentage - proteinPercentage;
            } else {
                carbPercentage = 60;
                proteinPercentage = 15;
                fatPercentage = 25;
            }
        }

        const nutritionData = [
            { name: '탄수화물', percentage: Math.round(carbPercentage), color: '#FF6B6B' },
            { name: '단백질', percentage: Math.round(proteinPercentage), color: '#4ECDC4' },
            { name: '지방', percentage: Math.round(fatPercentage), color: '#45B7D1' }
        ];

        let chartHTML = '<div class="nutrition-chart">';
        chartHTML += `<h4>영양소 구성비 ${nutritionInfo ? '(실제)' : '(추정)'}</h4>`;
        chartHTML += '<div class="chart-container">';

        nutritionData.forEach(nutrient => {
            chartHTML += `
                <div class="nutrition-bar">
                    <div class="nutrition-label">${nutrient.name}</div>
                    <div class="nutrition-progress">
                        <div class="nutrition-fill" 
                             style="width: ${nutrient.percentage}%; background-color: ${nutrient.color}">
                        </div>
                    </div>
                    <div class="nutrition-percent">${nutrient.percentage}%</div>
                </div>
            `;
        });

        chartHTML += '</div></div>';
        return chartHTML;
    }

    formatDate(dateString) {
        const date = new Date(dateString + 'T00:00:00');
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const weekday = weekdays[date.getDay()];

        return `${year}년 ${month}월 ${day}일 (${weekday})`;
    }

    showLoading() {
        document.getElementById('loading').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    showError(message = '해당 날짜의 급식 정보를 찾을 수 없습니다.') {
        const errorElement = document.getElementById('errorMessage');
        errorElement.querySelector('p').textContent = message;
        errorElement.classList.remove('hidden');
    }

    hideError() {
        document.getElementById('errorMessage').classList.add('hidden');
    }

    showMealInfo() {
        document.getElementById('mealInfo').classList.remove('hidden');
    }

    hideMealInfo() {
        document.getElementById('mealInfo').classList.add('hidden');
    }
}

// 페이지 로드 시 MealService 초기화
document.addEventListener('DOMContentLoaded', () => {
    new MealService();
});
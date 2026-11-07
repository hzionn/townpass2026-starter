
<script setup lang="ts">
import { ref, computed } from 'vue'

type LongTermStatus = 'yes' | 'no' | 'unknown' | ''
type CareType = 'home' | 'community' | 'unknown' | ''

const step = ref(0)
const longTermStatus = ref<LongTermStatus>('')
const careType = ref<CareType>('')
const district = ref('')

const districts = [
  '中正區', '大同區', '中山區', '松山區',
  '大安區', '萬華區', '信義區', '士林區',
  '北投區', '內湖區', '南港區', '文山區'
]

const canNext = computed(() => {
  if (step.value === 1) return !!longTermStatus.value
  if (step.value === 2) return !!careType.value
  if (step.value === 3) return !!district.value
  return true
})

const recommendation = computed(() => {
  if (longTermStatus.value === 'yes') {
    return '建議優先聯絡目前的長照個案管理員，確認可使用的喘息服務及安排方式。'
  }

  if (longTermStatus.value === 'no') {
    return '建議先撥打 1966 長照專線，提出照顧需求，由專業人員協助評估與轉介。'
  }

  return '如果不確定家人是否已有長照服務，可以先撥打 1966 詢問。'
})

const careTypeName = computed(() => {
  if (careType.value === 'home') return '居家喘息'
  if (careType.value === 'community') return '社區式喘息'
  return '由專人協助確認'
})

function next() {
  if (canNext.value && step.value < 4) {
    step.value++
  }
}

function back() {
  if (step.value > 0) step.value--
}

function restart() {
  step.value = 0
  longTermStatus.value = ''
  careType.value = ''
  district.value = ''
}
</script>

<template>
  <div class="app">

    <!-- Header -->
    <header class="header">
      <div class="header-top">
        <span class="brand">TownPass 微服務</span>
        <span class="version">CarePass</span>
      </div>

      <h1>照護通 CarePass</h1>
      <p>照顧別人的你，也值得被照顧。</p>
    </header>

    <main class="content">

      <!-- 首頁 -->
      <section v-if="step === 0" class="card">
        <div class="hero-icon">💚</div>

        <h2>需要喘口氣嗎？</h2>

        <p class="description">
          我們幫助家庭照顧者找到適合的喘息服務，
          不用再到處搜尋政府資源。
        </p>

        <div class="feature-list">
          <div>✓ 了解自己的照顧需求</div>
          <div>✓ 尋找適合的長照資源</div>
          <div>✓ 知道下一步該怎麼做</div>
        </div>

        <button class="primary-button" @click="next">
          開始尋找喘息服務 →
        </button>
      </section>

      <!-- Step 1 -->
      <section v-else-if="step === 1" class="card">
        <div class="progress-label">步驟 1 / 3</div>
        <div class="progress">
          <div style="width: 33%"></div>
        </div>

        <h2>了解您的照顧情況</h2>
        <p class="question">
          您的家人目前有使用政府長照服務嗎？
        </p>

        <button
          class="option-button"
          :class="{ selected: longTermStatus === 'yes' }"
          :aria-pressed="longTermStatus === 'yes'"
          @click="longTermStatus = 'yes'"
        >
          有，已經在使用
        </button>

        <button
          class="option-button"
          :class="{ selected: longTermStatus === 'no' }"
          :aria-pressed="longTermStatus === 'no'"
          @click="longTermStatus = 'no'"
        >
          沒有，還沒申請
        </button>

        <button
          class="option-button"
          :class="{ selected: longTermStatus === 'unknown' }"
          :aria-pressed="longTermStatus === 'unknown'"
          @click="longTermStatus = 'unknown'"
        >
          不確定
        </button>

        <button
          class="primary-button"
          :disabled="!canNext"
          @click="next"
        >
          下一步
        </button>

        <button class="back-button" @click="back">
          ← 返回
        </button>
      </section>

      <!-- Step 2 -->
      <section v-else-if="step === 2" class="card">
        <div class="progress-label">步驟 2 / 3</div>
        <div class="progress">
          <div style="width: 66%"></div>
        </div>

        <h2>您需要哪種協助？</h2>
        <p class="question">
          希望以什麼方式安排家人的照顧？
        </p>

        <button
          class="option-button"
          :class="{ selected: careType === 'home' }"
          :aria-pressed="careType === 'home'"
          @click="careType = 'home'"
        >
          🏠 希望有人到家裡照顧
        </button>

        <button
          class="option-button"
          :class="{ selected: careType === 'community' }"
          :aria-pressed="careType === 'community'"
          @click="careType = 'community'"
        >
          🏢 可以到日間照顧場所
        </button>

        <button
          class="option-button"
          :class="{ selected: careType === 'unknown' }"
          :aria-pressed="careType === 'unknown'"
          @click="careType = 'unknown'"
        >
          還不確定，希望有人建議
        </button>

        <button
          class="primary-button"
          :disabled="!canNext"
          @click="next"
        >
          下一步
        </button>

        <button class="back-button" @click="back">
          ← 上一步
        </button>
      </section>

      <!-- Step 3 -->
      <section v-else-if="step === 3" class="card">
        <div class="progress-label">步驟 3 / 3</div>
        <div class="progress">
          <div style="width: 100%"></div>
        </div>

        <h2>選擇服務地區</h2>

        <p class="question">
          您希望在哪個行政區尋找照顧資源？
        </p>

        <label for="district">臺北市行政區</label>

        <select id="district" v-model="district">
          <option value="" disabled>請選擇行政區</option>
          <option
            v-for="item in districts"
            :key="item"
            :value="item"
          >
            {{ item }}
          </option>
        </select>

        <button
          class="primary-button"
          :disabled="!canNext"
          @click="next"
        >
          查看我的建議
        </button>

        <button class="back-button" @click="back">
          ← 上一步
        </button>
      </section>

      <!-- 結果頁 -->
      <section v-else-if="step === 4" class="card">
        <div class="result-icon">✓</div>

        <h2>找到適合您的下一步</h2>

        <p class="description">
          根據您提供的需求，我們整理了以下資訊。
        </p>

        <div class="result-box">
          <div class="result-label">希望尋找的地區</div>
          <strong>臺北市 {{ district }}</strong>
        </div>

        <div class="result-box">
          <div class="result-label">照顧服務需求</div>
          <strong>{{ careTypeName }}</strong>
        </div>

        <div class="recommendation">
          <h3>💡 建議您這樣做</h3>
          <p>{{ recommendation }}</p>
          <p v-if="careType === 'home'">
            聯絡時可以說明您希望安排居家喘息服務。
          </p>
          <p v-else-if="careType === 'community'">
            聯絡時可以詢問社區式喘息服務的適用條件。
          </p>
        </div>

        <a class="primary-button call-button" href="tel:1966">
          📞 撥打 1966 長照專線
        </a>

        <p class="notice">
          本服務提供資訊引導，實際資格與服務安排
          仍須由正式長照服務窗口確認。
          目前尚未串接服務單位資料及即時名額。
        </p>

        <button class="back-button" @click="restart">
          ← 重新尋找
        </button>
      </section>

    </main>

    <footer class="footer">
      CarePass · 家庭照顧者資源導航
    </footer>
  </div>
</template>

<style>
/* 清除 Vite 預設樣式影響 */
:root {
  font-family: "PingFang TC", "Noto Sans TC", sans-serif;
  color: #30383d;
  background: #f1f3f4;
  color-scheme: light;
  font-synthesis: none;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  display: block;
  min-width: 320px;
  background: #f1f3f4;
}

#app {
  width: 100%;
  max-width: none;
  min-height: 100vh;
  margin: 0;
  padding: 0;
  text-align: left;
}

button,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

/* 主畫面 */
.app {
  width: 100%;
  max-width: 480px;
  min-height: 100dvh;
  margin: 0 auto;
  background: #f8f9fa;
  display: flex;
  flex-direction: column;
}

/* Header */
.header {
  background: white;
  padding: 22px 22px 26px;
  border-top: 5px solid #2eb6c7;
  border-bottom: 1px solid #e3e7e9;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.brand {
  color: #258a99;
  font-size: 14px;
  font-weight: 700;
}

.version {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 20px;
  background: #e4f6f8;
  color: #356c77;
}

.header h1 {
  color: #30383d;
  font-size: 26px;
  margin: 0 0 10px;
  line-height: 1.4;
}

.header p {
  color: #66747a;
  font-size: 15px;
  margin: 0;
}

/* Content */
.content {
  padding: 24px 16px;
  flex: 1;
}

.card {
  padding: 24px 20px;
  border: 1px solid #e3e7e9;
  border-radius: 18px;
  background: white;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
}

.hero-icon {
  font-size: 42px;
  margin-bottom: 16px;
}

h2 {
  color: #30383d;
  font-size: 24px;
  line-height: 1.4;
  margin: 0 0 16px;
}

.description {
  color: #526169;
  font-size: 17px;
  line-height: 1.8;
  margin: 0 0 24px;
}

/* Feature list */
.feature-list {
  background: #f1f9fa;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 24px;
}

.feature-list div {
  color: #356c77;
  font-size: 16px;
  margin-bottom: 12px;
}

.feature-list div:last-child {
  margin-bottom: 0;
}

/* Buttons */
.primary-button {
  display: block;
  width: 100%;
  min-height: 56px;
  padding: 15px;
  border: none;
  border-radius: 12px;
  background: #356c77;
  color: white;
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
}

.primary-button:hover {
  background: #285660;
}

.primary-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.option-button {
  display: block;
  width: 100%;
  min-height: 58px;
  padding: 16px;
  margin-bottom: 12px;
  border: 2px solid #e1e7e9;
  border-radius: 12px;
  background: white;
  color: #30383d;
  font-size: 17px;
  text-align: left;
}

.option-button.selected {
  background: #e7f7f9;
  border-color: #258a99;
  color: #245d67;
  font-weight: 700;
}

.back-button {
  display: block;
  width: 100%;
  margin-top: 16px;
  padding: 12px;
  border: none;
  background: transparent;
  color: #356c77;
  font-size: 16px;
}

button:focus-visible,
a:focus-visible,
select:focus-visible {
  outline: 3px solid #f5ba4b;
  outline-offset: 3px;
}

/* Question */
.question {
  color: #526169;
  font-size: 18px;
  line-height: 1.7;
  margin-bottom: 24px;
}

.progress-label {
  color: #258a99;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;
}

.progress {
  height: 8px;
  background: #e6edef;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 28px;
}

.progress div {
  height: 100%;
  border-radius: 8px;
  background: #2eb6c7;
}

/* Select */
label {
  display: block;
  margin-bottom: 10px;
  font-size: 16px;
  font-weight: 600;
}

select {
  width: 100%;
  min-height: 56px;
  padding: 12px;
  margin-bottom: 24px;
  border: 2px solid #dce5e8;
  border-radius: 12px;
  background: white;
  color: #30383d;
  font-size: 17px;
}

/* Result */
.result-icon {
  width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e2f6ef;
  color: #197a54;
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 20px;
}

.result-box {
  padding: 16px;
  background: #f5f8f9;
  border-radius: 12px;
  margin-bottom: 12px;
}

.result-label {
  color: #647279;
  font-size: 14px;
  margin-bottom: 8px;
}

.result-box strong {
  color: #30383d;
  font-size: 18px;
}

.recommendation {
  padding: 18px;
  margin: 24px 0;
  background: #eef8fa;
  border-left: 4px solid #2eb6c7;
  border-radius: 10px;
}

.recommendation h3 {
  color: #285f6c;
  font-size: 18px;
  margin: 0 0 12px;
}

.recommendation p {
  color: #42545b;
  line-height: 1.8;
  margin: 0 0 10px;
}

.recommendation p:last-child {
  margin-bottom: 0;
}

.call-button {
  margin-top: 20px;
}

.notice {
  font-size: 13px;
  color: #758188;
  line-height: 1.7;
  margin-top: 16px;
}

/* Footer */
.footer {
  padding: 18px;
  text-align: center;
  color: #9ba7ad;
  font-size: 12px;
}
</style>

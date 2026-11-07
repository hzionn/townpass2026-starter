# 把「託你辦」掛進城市通 App

這個資料夾放的是讓城市通 App（Flutter）多出一個「託你辦」入口的修改檔。App 本身不用懂 Flutter 也能套用，只要照下面做。

## 這個修改做了什麼

只改一個檔案：`lib/page/city_service/model/my_service_model.dart`。

- 新增服務 `MyServiceItemId.tuoNiBan`，名稱「託你辦」，說明「讓信任的人幫忙填寫申辦需求」。
- 分類是「市政服務」，圖示借用 App 現有的 `iconProtect`（沒有新增圖片）。
- 點下去會用 App 內建的網頁視窗開啟 `destinationUrl`。目前是**佔位網址** `https://YOUR-DEPLOYED-ORIGIN/`，要換成實際部署的網址。

## 1. 套用修改

先取得隊伍的 App fork（上游是 `taipei-doit/TownPass`，我們用 fork）：

```bash
git clone https://github.com/hzionn/TownPass.git
cd TownPass
git checkout -b feature/tuoniban-service
git apply /path/to/tuoniban-service.patch   # 換成這個 patch 檔實際所在位置
```

套用前想先確認能不能成功，可以先跑 `git apply --check /path/to/tuoniban-service.patch`，沒有輸出就代表可以。

## 2. 換成實際網址

打開 `lib/page/city_service/model/my_service_model.dart`，找到 `MyServiceItemId.tuoNiBan`，把

```dart
destinationUrl: 'https://YOUR-DEPLOYED-ORIGIN/',
```

改成部署好的 HTTPS 網址（要有 HTTPS，結尾的 `/` 保留）。同一段旁邊有一行 `TODO` 註解，換完可以刪掉。

## 3. 跑起來

```bash
fvm install                  # 沒有用 fvm 就略過這行和後面所有 fvm
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run
```

- `.fvmrc` 指定 Flutter 3.47.6；3.47.8 我們也跑成功過。
- Android 需要 Java 17；iOS 需要 Mac 和 Xcode（要先同意 Xcode 授權）。
- 改網址只需要重新 `flutter run`（或熱重啟），不用重跑 build_runner。

## 4. 在 App 裡找到服務

1. 打開 App，點下方「服務」。
2. 點「更多」，進入服務列表。
3. 在「市政服務」分類找到「託你辦」。
4. 點右上角編輯，點「託你辦」把它加入「我的服務」（最多 12 個）。
5. 回到服務頁，點它就會用內建網頁視窗開啟網址。

在編輯模式以外，直接在「更多」列表點「託你辦」也會開啟網頁。

## 注意

- 雙向溝通（`window.flutterObject`）只有在 App 內才能運作，一般瀏覽器沒有。
- App 的網頁視窗上方已經有 App 自己的標題列（標題取自網頁的 `document.title`，右上有關閉鈕），網頁就不用再放一個一樣的標題列。
- **發 PR 前先確認目標：** 隊伍的 fork 上游是官方 repo，GitHub 網頁和 `gh pr create` 可能預設把 PR 發到 `taipei-doit/TownPass`。目標要選 `hzionn/TownPass`，或先在 clone 裡跑 `gh repo set-default hzionn/TownPass`。

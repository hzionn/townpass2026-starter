# 託你辦 iOS／Android 模擬器執行指南

本機需要同時開啟「託你辦網頁」和「城市通 App」。請準備兩份專案資料夾，並開啟兩個 Terminal。

## Terminal 1：啟動託你辦網頁

```bash
git checkout feature/tuo-ni-ban
cd tuoniban
npm ci
npm run dev
```

看到 `http://localhost:5173` 就代表網頁已啟動。

## Terminal 2：啟動城市通 App

```bash
git checkout townpass-service
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run
```

`npm ci`、`flutter pub get` 和 `build_runner` 第一次執行即可。之後通常只需要執行 `npm run dev` 和 `flutter run`。

## 選擇模擬器

- iOS：先開啟 iOS Simulator，再執行 `flutter run`。
- Android：先從 Android Studio 的 Device Manager 開啟 Android Emulator，再執行 `flutter run`。

Android Emulator 不能使用電腦的 `localhost`。如果託你辦網頁無法開啟，請把城市通 App 裡的服務網址改成 `http://10.0.2.2:5173/`。

## 在 App 裡開啟託你辦

城市通 App 啟動後，依序點選：

```text
服務 → 更多 → 市政服務 → 託你辦
```

如果沒有看到「託你辦」，請在執行 `flutter run` 的 Terminal 按大寫 `R`，重新啟動 App。

## 停止服務

回到兩個 Terminal，分別按 `Control + C`。

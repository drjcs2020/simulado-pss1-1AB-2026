# Leitor PSS 1 — Android nativo

**Projeto novo** (React Native + VisionCamera V5 + OpenCV + Skia), sem substituir a versão web que está publicada. Identidade: Colégio Estadual Padre Nicolau Baltazar.

## O que está implementado
- Leitura do QR Code nativa com ML Kit via `CodeScanner`, validando turma/número/tipo.
- Vídeo em tempo real com `SkiaCamera`. A cada ~350 ms, uma cópia reduzida do quadro passa por OpenCV (BGR → cinza → máscara binária) e pelo detector de dezenas e unidades.
- Contornos verdes no quadro, três leituras iguais para estabilizar, vibração e revisão manual tocando os círculos **01, 02, 04, 08**. Corrigir uma resposta bloqueia sua substituição automática.
- Gravação e reset apenas após confirmação do Google Sheets, pela URL atual do Apps Script. Não grava automaticamente após três quadros.
- Menu com as quatro abas do aplicativo original, nome da escola, turmas 1A/1B (46 estudantes), gabaritos A/B/C.

### Nota sobre a folha real
O cartão existente **não contém quatro âncoras pretas independentes**; ele tem 10 caixas verticais de respostas. O detector usa a grade dessas 10 caixas e calcula quatro cantos externos. Para usar outra folha será necessário adaptar `src/omr.ts`.

## Preparar Android

Requer computador com Node.js 22+, Android Studio/SDK, Java (JDK exigido pelo Expo/RN) e celular Android ou emulador com câmera. **O projeto não roda no Expo Go**: depende de módulos nativos.

A partir da raiz do repositório:

```bash
# 1. Gerar projeto Expo com versões compatíveis entre React, RN e Expo
npx create-expo-app@latest PSS1Android --template blank-typescript
cd PSS1Android

# 2. Instalar os módulos nativos; mantenha VisionCamera na major 5
npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets @react-native-async-storage/async-storage
npm install react-native-vision-camera@^5 react-native-nitro-modules react-native-nitro-image
npm install react-native-vision-camera-worklets react-native-vision-camera-skia react-native-vision-camera-resizer react-native-vision-camera-barcode-scanner react-native-fast-opencv

# 3. Copiar os arquivos do diretório android-native para a raiz de PSS1Android:
#    App.tsx, app.json, babel.config.js e a pasta src/

# 4. Gerar componentes nativos e compilar (não é um site do GitHub Pages)
npx expo prebuild --platform android
npx expo run:android
```

Use `npx expo install --check` para auditar compatibilidade; atualizações de módulos nativos exigem uma nova build. O código está estruturado para **VisionCamera V5** (`SkiaCamera` + `useResizer`) e não é compatível com a API V4 (`useSkiaFrameProcessor`/`runAtTargetFps`).

## Validação antes de aplicar oficialmente
1. Autorizar a câmera. Ler QR `PSS1|1A|01|A`: selecionar aluno 1A-01 e iniciar câmera das respostas.
2. Enquadrar as dez caixas; os círculos devem aparecer **sobre quadrados preenchidos**, nunca sobre o QR Code.
3. Três leituras iguais → vibrar e habilitar conferência. Se marcação ausente, a questão fica vazia.
4. Corrigir uma questão tocando em **01/02/04/08**; observar que a marcação manual não é substituída.
5. Salvar teste e conferir valores por questão na planilha; testar reset com um lançamento de teste.
6. Executar em **um aparelho Android real**. Ajustar geometria de rotação, limites de detecção e iluminação se necessário.

**Status:** código-fonte inicial publicado. **Não compilado nem validado em dispositivo Android nesta sessão. Não existe APK pronto neste repositório.** O backend Apps Script do Google Sheets precisa estar implantado com versão 4 para permitir reset; publicar o código no GitHub não atualiza a implantação.

Documentação técnica:
- https://visioncamera.margelo.com/docs/skia-frame-processors
- https://visioncamera.margelo.com/docs/barcode-scanner
- https://lukaszkurantdev.github.io/react-native-fast-opencv/examples/realtimedetection

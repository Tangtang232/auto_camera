# 第三方组件说明

## GAIC 构图评分模型（`models/gaic_mobilenetv2.onnx`）

- 原始研究：Hui Zeng, Lida Li, Zisheng Cao, Lei Zhang. *Grid Anchor based Image Cropping: A New Benchmark and An Efficient Model.* IEEE TPAMI；以及 CVPR 2019 的 *Reliable and Efficient Image Cropping: A Grid Anchor based Approach*。
- 原始代码和预训练权重：https://github.com/HuiZeng/Grid-Anchor-based-Image-Cropping-Pytorch （MIT License）。
- 本仓库使用的 ONNX 文件来自 https://github.com/ganlanyuan/view-model-weights/releases/tag/v2 （`gaic_composition_mobilenetv2.onnx`）。转换者把原版的 RoIAlign/RoDAlign 自定义算子改写成了针对固定 256×256 输入、固定 90 个候选框的普通运算。转换者没有另行声明许可证；这里按原始 MIT 许可注明出处，仅供个人非商业使用。如果权利人要求，会移除这个文件。
- sha256：`3d87b59bdb7fd4c97319f7e9aeb0bcc1021b17e81e6ff1782ad1b959681eb1f5`

## 运行时从 CDN 加载、不随仓库分发的组件

- MediaPipe Tasks Vision（Pose Landmarker 模型）：Apache-2.0，Google。
- MediaPipe Image Classifier 的 EfficientNet-Lite0（int8，ImageNet 1000 类）：Google 提供，运行时从 Google 的模型存储地址下载，用于识别场景。MediaPipe 文档页没有单独写明这个模型文件的许可证，本仓库不分发这个文件。
- ONNX Runtime Web：MIT，Microsoft。

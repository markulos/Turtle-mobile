//  TURTLE'S COPY of expo-live-activity's widget view.
//
//  The library ships this file in its own `ios-files/`, and its config plugin
//  copies whatever is there into ios/LiveActivity/ at prebuild. There is no
//  option to point that plugin somewhere else, and editing node_modules lasts
//  until the next install — so this is the edited copy, kept in the repo, and
//  `plugins/withTurtleLiveActivity.js` writes it over the library's after the
//  library's plugin has run.
//
//  WHAT IS CHANGED, and nothing else:
//    • The COUNTDOWN moved to the TOP RIGHT and got much larger. It used to be
//      the small label ProgressView(timerInterval:) draws under its own bar —
//      bottom-left, caption-sized, which is the least prominent spot on the
//      card for the one number the card exists to show. It is now a
//      Text(timerInterval:) in the header row: 44pt, bold, rounded,
//      monospaced digits so it does not jiggle as the digits change.
//    • The bar keeps its place but loses its labels (EmptyView for both), so
//      the time is not printed twice.
//  Everything else — images, padding, colours, the stretch layout — is the
//  library's, untouched, so a version bump is a re-diff rather than a rewrite.

import SwiftUI
import WidgetKit

#if canImport(ActivityKit)

  struct ConditionalForegroundViewModifier: ViewModifier {
    let color: String?

    func body(content: Content) -> some View {
      if let color = color {
        content.foregroundStyle(Color(hex: color))
      } else {
        content
      }
    }
  }

  struct DebugLog: View {
    #if DEBUG
      private let message: String
      init(_ message: String) {
        self.message = message
        print(message)
      }

      var body: some View {
        Text(message)
          .font(.caption2)
          .foregroundStyle(.red)
      }
    #else
      init(_: String) {}
      var body: some View { EmptyView() }
    #endif
  }

  struct LiveActivityView: View {
    let contentState: LiveActivityAttributes.ContentState
    let attributes: LiveActivityAttributes
    @State private var imageContainerSize: CGSize?

    var progressViewTint: Color? {
      attributes.progressViewTint.map { Color(hex: $0) }
    }

    private var imageAlignment: Alignment {
      switch attributes.imageAlign {
      case "center":
        return .center
      case "bottom":
        return .bottom
      default:
        return .top
      }
    }

    private func alignedImage(imageName: String) -> some View {
      let defaultHeight: CGFloat = 64
      let defaultWidth: CGFloat = 64
      let containerHeight = imageContainerSize?.height
      let containerWidth = imageContainerSize?.width
      let hasWidthConstraint = (attributes.imageWidthPercent != nil) || (attributes.imageWidth != nil)

      let computedHeight: CGFloat? = {
        if let percent = attributes.imageHeightPercent {
          let clamped = min(max(percent, 0), 100) / 100.0
          // Use the row height as a base. Fallback to default when row height is not measured yet.
          let base = (containerHeight ?? defaultHeight)
          return base * clamped
        } else if let size = attributes.imageHeight {
          return CGFloat(size)
        } else if hasWidthConstraint {
          // Mimic CSS: when only width is set, keep height automatic to preserve aspect ratio
          return nil
        } else {
          // Mimic CSS: this works against CSS but provides a better default behavior.
          // When no width/height is set, use a default size (64pt)
          // Width will adjust automatically base on aspect ratio
          return defaultHeight
        }
      }()

      let computedWidth: CGFloat? = {
        if let percent = attributes.imageWidthPercent {
          let clamped = min(max(percent, 0), 100) / 100.0
          let base = (containerWidth ?? defaultWidth)
          return base * clamped
        } else if let size = attributes.imageWidth {
          return CGFloat(size)
        } else {
          return nil // Keep aspect fit based on height
        }
      }()

      return ZStack(alignment: .center) {
        Group {
          let fit = attributes.contentFit ?? "cover"
          switch fit {
          case "contain":
            Image.dynamic(assetNameOrPath: imageName).resizable().scaledToFit().frame(width: computedWidth, height: computedHeight)
          case "fill":
            Image.dynamic(assetNameOrPath: imageName).resizable().frame(
              width: computedWidth,
              height: computedHeight
            )
          case "none":
            Image.dynamic(assetNameOrPath: imageName).renderingMode(.original).frame(width: computedWidth, height: computedHeight)
          case "scale-down":
            if let uiImage = UIImage.dynamic(assetNameOrPath: imageName) {
              // Determine the target box. When width/height are nil, we use image's intrinsic dimension for comparison.
              let targetHeight = computedHeight ?? uiImage.size.height
              let targetWidth = computedWidth ?? uiImage.size.width
              let shouldScaleDown = uiImage.size.height > targetHeight || uiImage.size.width > targetWidth

              if shouldScaleDown {
                Image(uiImage: uiImage)
                  .resizable()
                  .scaledToFit()
                  .frame(width: computedWidth, height: computedHeight)
              } else {
                Image(uiImage: uiImage)
                  .renderingMode(.original)
                  .frame(width: min(uiImage.size.width, targetWidth), height: min(uiImage.size.height, targetHeight))
              }
            } else {
              DebugLog("⚠️[ExpoLiveActivity] assetNameOrPath couldn't resolve to UIImage")
            }
          case "cover":
            Image.dynamic(assetNameOrPath: imageName).resizable().scaledToFill().frame(
              width: computedWidth,
              height: computedHeight
            ).clipped()
          default:
            DebugLog("⚠️[ExpoLiveActivity] Unknown contentFit '\(fit)'")
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: imageAlignment)
      .background(
        GeometryReader { proxy in
          Color.clear
            .onAppear {
              let s = proxy.size
              if s.width > 0, s.height > 0 { imageContainerSize = s }
            }
            .onChange(of: proxy.size) { s in
              if s.width > 0, s.height > 0 { imageContainerSize = s }
            }
        }
      )
    }

    var body: some View {
      let defaultPadding = 24

      let top = CGFloat(
        attributes.paddingDetails?.top
          ?? attributes.paddingDetails?.vertical
          ?? attributes.padding
          ?? defaultPadding
      )

      let bottom = CGFloat(
        attributes.paddingDetails?.bottom
          ?? attributes.paddingDetails?.vertical
          ?? attributes.padding
          ?? defaultPadding
      )

      let leading = CGFloat(
        attributes.paddingDetails?.left
          ?? attributes.paddingDetails?.horizontal
          ?? attributes.padding
          ?? defaultPadding
      )

      let trailing = CGFloat(
        attributes.paddingDetails?.right
          ?? attributes.paddingDetails?.horizontal
          ?? attributes.padding
          ?? defaultPadding
      )

      VStack(alignment: .leading) {
        let position = attributes.imagePosition ?? "right"
        let isStretch = position.contains("Stretch")
        let isLeftImage = position.hasPrefix("left")
        let hasImage = contentState.imageName != nil
        let effectiveStretch = isStretch && hasImage

        HStack(alignment: .top) {
          if hasImage, isLeftImage {
            if let imageName = contentState.imageName {
              alignedImage(imageName: imageName)
            }
          }

          VStack(alignment: .leading, spacing: 2) {
            Text(contentState.title)
              .font(.title2)
              .fontWeight(.semibold)
              .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))

            if let subtitle = contentState.subtitle {
              Text(subtitle)
                .font(.title3)
                .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
            }

            if effectiveStretch {
              if let date = contentState.timerEndDateInMilliseconds {
                ProgressView(timerInterval: Date.toTimerInterval(miliseconds: date)) {
                  EmptyView()
                } currentValueLabel: {
                  EmptyView()
                }
                .tint(progressViewTint)
              } else if let progress = contentState.progress {
                ProgressView(value: progress)
                  .tint(progressViewTint)
              }
            }
          }.layoutPriority(1)

          // THE COUNTDOWN — top right, and the biggest thing on the card.
          //
          // Text(timerInterval:) is iOS's own self-updating timer, the same
          // mechanism the progress bar's label used: set once, counted down by
          // the system, so this still costs no per-second updates and keeps
          // running with the app backgrounded or killed.
          //
          // It takes the title's colour rather than the bar label's: it IS the
          // headline now, and the bar label colour is tuned for small text on
          // the tint.
          if !hasImage, let date = contentState.timerEndDateInMilliseconds {
            Spacer(minLength: 8)
            Text(timerInterval: Date.toTimerInterval(miliseconds: date), countsDown: true)
              .font(.system(size: 44, weight: .bold, design: .rounded))
              .monospacedDigit()
              .lineLimit(1)
              // Shrinks rather than truncating: "59:59" is wider than "9:59",
              // and a clipped countdown is worse than a slightly smaller one.
              .minimumScaleFactor(0.5)
              .multilineTextAlignment(.trailing)
              .fixedSize(horizontal: true, vertical: false)
              .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
          }

          if hasImage, !isLeftImage { // right side (default)
            Spacer()
            if let imageName = contentState.imageName {
              alignedImage(imageName: imageName)
            }
          }
        }

        if !effectiveStretch {
          if let date = contentState.timerEndDateInMilliseconds {
            // No labels: the countdown is the headline in the header row now,
            // and printing the same number twice on a card this small reads as
            // a bug. EmptyView for both is how ProgressView is told to draw
            // only the bar.
            ProgressView(timerInterval: Date.toTimerInterval(miliseconds: date)) {
              EmptyView()
            } currentValueLabel: {
              EmptyView()
            }
            .tint(progressViewTint)
          } else if let progress = contentState.progress {
            ProgressView(value: progress)
              .tint(progressViewTint)
          }
        }
      }
      .padding(EdgeInsets(top: top, leading: leading, bottom: bottom, trailing: trailing))
    }
  }

#endif

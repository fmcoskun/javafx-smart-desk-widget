package com.iot.widget;

import java.util.Locale;
import java.util.Random;

import javafx.animation.Animation;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Application;
import javafx.concurrent.Worker;
import javafx.scene.Scene;
import javafx.scene.input.MouseButton;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import javafx.stage.Stage;
import javafx.stage.StageStyle;
import javafx.util.Duration;
import netscape.javascript.JSObject;

/**
 * Smart Desk Hub - JavaFX + WebView desktop widget (Electron main.js equivalent).
 */
public class App extends Application {

    // Width starts collapsed and is then animated by JavaBridge.expandWindow/collapseWindow;
    // height is fitted to the content by the page via JavaBridge.fitHeight()
    private static final double WIDTH = JavaBridge.COLLAPSED_WIDTH;
    private static final double HEIGHT = 620;

    private WebEngine engine;
    // Strong reference so the bridge is not garbage collected (see JavaBridge javadoc)
    private JavaBridge bridge;

    private double dragOffsetX;
    private double dragOffsetY;
    private boolean dragging;

    @Override
    public void start(Stage stage) {
        WebView webView = new WebView();
        webView.setContextMenuEnabled(false);
        // Transparent page background so the rounded card and its shadow blend into the desktop
        webView.setPageFill(Color.TRANSPARENT);
        engine = webView.getEngine();

        // The WebView is always as wide as the expanded window; the Stage only clips it.
        // So the width animation never makes WebKit re-layout/repaint the page on each frame.
        webView.setMinWidth(JavaBridge.EXPANDED_WIDTH);
        webView.setPrefWidth(JavaBridge.EXPANDED_WIDTH);
        webView.setMaxWidth(JavaBridge.EXPANDED_WIDTH);
        Pane root = new Pane(webView);
        root.setStyle("-fx-background-color: transparent;"); // the default .root style is opaque grey
        webView.prefHeightProperty().bind(root.heightProperty());

        Scene scene = new Scene(root, WIDTH, HEIGHT);
        scene.setFill(Color.TRANSPARENT);

        stage.initStyle(StageStyle.TRANSPARENT);
        stage.setTitle("Smart Desk Hub");
        // Not user-resizable (there are no OS borders anyway); this does not block the
        // programmatic stage.setWidth() calls used by the expand/collapse animation.
        stage.setResizable(false);
        stage.setScene(scene);

        bridge = new JavaBridge(stage, webView);
        enableWindowDragging(webView, stage);

        // Equivalent of Electron's 'ready-to-show': inject the bridge, then show the window
        engine.getLoadWorker().stateProperty().addListener((obs, oldState, newState) -> {
            if (newState == Worker.State.SUCCEEDED) {
                JSObject window = (JSObject) engine.executeScript("window");
                window.setMember("javaBridge", bridge);
                engine.executeScript("window.onJavaBridgeReady && window.onJavaBridgeReady()");
                stage.show();
                startSensorFeed();
            } else if (newState == Worker.State.FAILED) {
                System.err.println("Failed to load UI: " + engine.getLoadWorker().getException());
            }
        });
        engine.setOnAlert(e -> bridge.log("ALERT", e.getData()));

        engine.load(App.class.getResource("/ui/index.html").toExternalForm());
    }

    /**
     * Frameless window dragging. On mouse press we ask the page whether the point is
     * inside a [data-drag-region] element (the title bar); if so, mouse drags move the Stage.
     */
    private void enableWindowDragging(WebView webView, Stage stage) {
        webView.addEventFilter(MouseEvent.MOUSE_PRESSED, e -> {
            if (e.getButton() != MouseButton.PRIMARY) return;
            Object hit = engine.executeScript(
                    "window.isDragRegion && window.isDragRegion(" + e.getX() + "," + e.getY() + ")");
            dragging = Boolean.TRUE.equals(hit);
            dragOffsetX = e.getScreenX() - stage.getX();
            dragOffsetY = e.getScreenY() - stage.getY();
        });
        webView.addEventFilter(MouseEvent.MOUSE_DRAGGED, e -> {
            if (!dragging) return;
            stage.setX(e.getScreenX() - dragOffsetX);
            stage.setY(e.getScreenY() - dragOffsetY);
            e.consume();
        });
        webView.addEventFilter(MouseEvent.MOUSE_RELEASED, e -> dragging = false);
    }

    /**
     * Java -> JS direction: pushes simulated room sensor values into the page every 5s.
     * Replace with real sensor/MQTT data; if it comes from another thread,
     * wrap the executeScript call in Platform.runLater(...).
     */
    private void startSensorFeed() {
        Random random = new Random();
        double[] values = {22.4, 48};
        Timeline feed = new Timeline(new KeyFrame(Duration.seconds(5), e -> {
            values[0] += (random.nextDouble() - 0.5) * 0.4;
            values[1] += (random.nextDouble() - 0.5) * 2;
            // Locale.ROOT keeps the decimal point a '.' (Turkish locale would write 22,4)
            engine.executeScript(String.format(Locale.ROOT,
                    "window.onSensorUpdate && window.onSensorUpdate(%.2f, %.2f)", values[0], values[1]));
        }));
        feed.setCycleCount(Animation.INDEFINITE);
        feed.play();
    }

    public static void main(String[] args) {
        launch(args);
    }
}

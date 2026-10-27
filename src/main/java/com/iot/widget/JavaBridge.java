package com.iot.widget;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

import javafx.animation.Interpolator;
import javafx.animation.KeyFrame;
import javafx.animation.KeyValue;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.beans.property.DoubleProperty;
import javafx.beans.property.SimpleDoubleProperty;
import javafx.geometry.Rectangle2D;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import javafx.stage.Screen;
import javafx.stage.Stage;
import javafx.util.Duration;

/**
 * The object exposed to JavaScript as {@code window.javaBridge}
 * (the JavaFX equivalent of Electron's preload.js + ipcMain).
 *
 * Rules for a bridge class:
 *  - the class and every method called from JS must be public;
 *  - App keeps a strong reference to it, otherwise it may be garbage
 *    collected and calls from JS silently stop working;
 *  - JS calls arrive on the JavaFX Application Thread, so the Stage
 *    can be touched directly here.
 */
public class JavaBridge {

    /** Window width with only the main panel / with the detail panel open (must match style.css). */
    public static final double COLLAPSED_WIDTH = 360;
    public static final double EXPANDED_WIDTH = 680;
    private static final Duration ANIMATION_DURATION = Duration.millis(280);

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

    private final Stage stage;
    private final WebView webView;
    private final WebEngine engine;
    private Timeline widthAnimation;
    private boolean expandLeft;

    public JavaBridge(Stage stage, WebView webView) {
        this.stage = stage;
        this.webView = webView;
        this.engine = webView.getEngine();
    }

    // ---- Window controls -------------------------------------------------

    public void minimize() {
        stage.setIconified(true);
    }

    public void close() {
        Platform.exit();
    }

    /** Toggles "Always on Top" and returns the new state to JS. */
    public boolean togglePin() {
        boolean pinned = !stage.isAlwaysOnTop();
        stage.setAlwaysOnTop(pinned);
        System.out.println(now() + " [WINDOW] Always on top: " + pinned);
        return pinned;
    }

    /** Fits the window height to the HTML content (CSS pixels); width is owned by expand/collapse. */
    public void fitHeight(double height) {
        stage.setHeight(Math.ceil(height));
    }

    // ---- Expand / collapse (detail panel) --------------------------------

    /**
     * Opens the detail panel by widening the window to 680px. Normally it grows to the
     * right; if there is not enough room on the screen it grows to the left instead.
     */
    public void expandWindow(String type) {
        // Pick the side only from the fully collapsed state; when re-opening during a
        // collapse animation, keep the side the page is currently laid out for.
        if (stage.getWidth() <= COLLAPSED_WIDTH) {
            expandLeft = stage.getX() + EXPANDED_WIDTH > screenBounds().getMaxX();
            setDetailSide(expandLeft);
        }
        System.out.println(now() + " [WINDOW] Expand: " + type + (expandLeft ? " (to the left)" : ""));
        animateWidth(EXPANDED_WIDTH, "window.onWindowExpanded && window.onWindowExpanded('" + type + "')");
    }

    /** Closes the detail panel by shrinking the window back to 360px. */
    public void collapseWindow() {
        System.out.println(now() + " [WINDOW] Collapse");
        animateWidth(COLLAPSED_WIDTH, "window.onWindowCollapsed && window.onWindowCollapsed()");
    }

    private void animateWidth(double target, String onFinishedScript) {
        if (widthAnimation != null) {
            widthAnimation.stop(); // a click mid-animation continues from the current width
        }
        // When growing to the left, the right edge stays where it is
        double rightEdge = stage.getX() + stage.getWidth();

        // Stage.width is read-only for KeyValue, so animate a helper property and mirror it
        DoubleProperty width = new SimpleDoubleProperty(stage.getWidth());
        width.addListener((obs, oldWidth, newWidth) -> {
            double w = Math.round(newWidth.doubleValue());
            stage.setWidth(w);
            if (expandLeft) {
                // x and width are applied to the native window together on the next pulse
                stage.setX(rightEdge - w);
                // The 680px page is right-aligned in the window, so the main panel stays put
                webView.setLayoutX(w - EXPANDED_WIDTH);
            }
        });

        widthAnimation = new Timeline(new KeyFrame(ANIMATION_DURATION,
                new KeyValue(width, target, Interpolator.EASE_BOTH)));
        widthAnimation.setOnFinished(e -> {
            if (target == COLLAPSED_WIDTH && expandLeft) {
                // Back to the normal layout: main panel at the page's left edge
                expandLeft = false;
                setDetailSide(false);
            }
            engine.executeScript(onFinishedScript);
        });
        widthAnimation.play();
    }

    /** Lays the page out with the detail panel on the left or right of the main panel. */
    private void setDetailSide(boolean left) {
        engine.executeScript("window.setDetailSide && window.setDetailSide('" + (left ? "left" : "right") + "')");
        // Left layout: the main panel sits at the page's right end, so shift the
        // page left to keep it inside the (still 360px wide) window
        webView.setLayoutX(left ? stage.getWidth() - EXPANDED_WIDTH : 0);
    }

    /** Usable area (without the taskbar) of the screen the window is on. */
    private Rectangle2D screenBounds() {
        return Screen.getScreensForRectangle(stage.getX(), stage.getY(), stage.getWidth(), stage.getHeight())
                .stream().findFirst().orElse(Screen.getPrimary())
                .getVisualBounds();
    }

    // ---- IoT / logging ---------------------------------------------------

    /**
     * Called for every switch, slider and scene change in the UI.
     * Plug a real MQTT client in here (e.g. Eclipse Paho:
     * {@code client.publish(topic, new MqttMessage(json.getBytes()))}).
     */
    public void publish(String topic, String json) {
        System.out.println(now() + " [MQTT PUB] " + topic + " -> " + json);
    }

    /** Receives console.log / console.error output from JS. */
    public void log(String level, String message) {
        System.out.println(now() + " [JS " + level + "] " + message);
    }

    private static String now() {
        return LocalTime.now().format(TIME);
    }
}

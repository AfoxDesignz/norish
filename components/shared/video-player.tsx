"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { SpeakerWaveIcon, SpeakerXMarkIcon, PlayIcon } from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";

import VideoPlayerSkeleton from "@/components/skeleton/video-player-skeleton";

export interface VideoPlayerProps {
  src: string;
  duration?: number | null;
  poster?: string;
  className?: string;
}

export default function VideoPlayer({ src, duration, poster, className = "" }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const t = useTranslations("recipes.carousel.videoPlayer");

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showControls, setShowControls] = useState(false);

  // Format seconds to mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Autoplay observer
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.muted = true;
            setIsMuted(true);
            video.play().catch(() => {
              // Autoplay might fail, that's okay
              setIsPlaying(false);
            });
            setIsPlaying(true);
          } else {
            video.pause();
            setIsPlaying(false);
          }
        });
      },
      { threshold: 0.6 } // Start playing when 60% visible
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, [src]);

  // Video event handlers
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      const total = videoRef.current.duration || duration || 0;
      setCurrentTime(current);
      if (total > 0) {
        setProgress((current / total) * 100);
      }
    }
  };

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = (e: any) => {
    // HeroUI Button onPress/onClick handling
    if (e?.stopPropagation) e.stopPropagation();

    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleLoadedData = () => {
    setIsLoading(false);
  };

  const handleTouchStart = () => {
    setShowControls(true);
    // Hide controls after 2.5 seconds of no interaction
    const timer = setTimeout(() => setShowControls(false), 2500);
    return () => clearTimeout(timer);
  };

  // Tap to play/pause
  const handleTap = (e: React.MouseEvent | React.TouchEvent) => {
    togglePlay();
  };

  return (
    <div
      ref={containerRef}
      className={`group relative aspect-[9/16] overflow-hidden bg-black sm:aspect-video ${className}`}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      onTouchStart={handleTouchStart}
      onClick={handleTap}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="h-full w-full object-cover"
        playsInline
        loop
        muted={isMuted}
        onTimeUpdate={handleTimeUpdate}
        onLoadedData={handleLoadedData}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
      />

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="absolute inset-0">
          <VideoPlayerSkeleton className="h-full rounded-none" />
        </div>
      )}

      {/* Controls Overlay */}
      <AnimatePresence>
        {(showControls || !isPlaying) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60"
          >
            {/* Center: Play/Pause Big Icon */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {!isPlaying && (
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  className="rounded-full bg-black/40 p-4 backdrop-blur-sm"
                >
                  <PlayIcon className="h-8 w-8 text-white" />
                </motion.div>
              )}
            </div>

            {/* Bottom: Mute, Progress & Time */}
            <div className="pointer-events-auto absolute right-0 bottom-0 left-0 space-y-2 p-4">
              <div className="flex items-center justify-between px-1 text-xs font-medium text-white/90">
                <div className="flex items-center gap-2">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    aria-label={isMuted ? t("unmute") : t("mute")}
                    className="rounded-full text-white/90 backdrop-blur-md hover:bg-white/20 hover:text-white"
                    onPress={toggleMute}
                  >
                    {isMuted ? (
                      <SpeakerXMarkIcon className="h-5 w-5" />
                    ) : (
                      <SpeakerWaveIcon className="h-5 w-5" />
                    )}
                  </Button>
                  <span>{formatTime(currentTime)}</span>
                </div>
                <span>{formatTime(duration || videoRef.current?.duration || 0)}</span>
              </div>

              {/* Progress Bar */}
              <div
                className="group/progress relative h-1 w-full cursor-pointer overflow-hidden rounded-full bg-white/30"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!videoRef.current) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percent = x / rect.width;
                  const newTime = percent * (duration || videoRef.current.duration || 0);
                  videoRef.current.currentTime = newTime;
                }}
              >
                <motion.div
                  className="absolute top-0 left-0 h-full rounded-full bg-white"
                  style={{ width: `${progress}%` }}
                  layoutId="progress"
                />
                <div className="absolute inset-0 bg-white/0 transition-colors group-hover/progress:bg-white/10" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

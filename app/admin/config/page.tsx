"use client"

import {
  Save,
  Cable,
  MessageSquareText,
  Brain,
  Settings2,
  Wrench,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { ErrorState } from "@/components/admin/data-state"

import { useConfigForm } from "@/components/admin/config/use-config-form"
import { QqSettings } from "@/components/admin/config/qq-settings"
import { TgSettings } from "@/components/admin/config/tg-settings"
import { AdminSettings } from "@/components/admin/config/admin-settings"
import { ReplySettings } from "@/components/admin/config/reply-settings"
import { SdkSettings } from "@/components/admin/config/sdk-settings"
import { SessionSettings } from "@/components/admin/config/session-settings"
import { KnowledgePrefetchSettings } from "@/components/admin/config/knowledge-settings"
import { ReflectSettings } from "@/components/admin/config/reflect-settings"
import { ProactiveSettings } from "@/components/admin/config/proactive-settings"
import { NotifySettings } from "@/components/admin/config/notify-settings"
import { StorageSettings } from "@/components/admin/config/storage-settings"
import { BrandSettings } from "@/components/admin/config/brand-settings"

const CATEGORIES = [
  { value: "base", label: "基础与管理", icon: Settings2 },
  { value: "channels", label: "渠道接入", icon: Cable },
  { value: "conversation", label: "对话与自动化", icon: MessageSquareText },
  { value: "knowledge", label: "知识与通知", icon: Brain },
  { value: "advanced", label: "系统高级", icon: Wrench },
] as const

// 卡片网格:宽屏两列,窄屏单列。设置项各自是独立的 SectionCard,
// 与其余页面同一套卡片语言,不再另起左侧竖排导航。
function SettingsGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid items-start gap-4 xl:grid-cols-2">{children}</div>
}

export default function ConfigPage() {
  const {
    cfg,
    setCfg,
    updateField,
    fieldValue,
    groups,
    groupsLoading,
    admins,
    adminsLoading,
    enabledQqIds,
    enabledTgIds,
    adminQq,
    toggleGroup,
    adminLabel,
    toggleExtraAt,
    groupName,
    tgChatDraft,
    setTgChatDraft,
    addTgChat,
    removeTgChat,
    tgTokenConfigured,
    tgBypassWarn,
    tgChannel,
    tgChatTitle,
    setAdminChannel,
    setAdminChatId,
    adminGroupOptions,
    adminTgOptions,
    busy,
    dirty,
    save,
    error,
    reload,
  } = useConfigForm()

  return (
    <PageShell>
      <PageHeader
        title="配置"
        description="按用途整理品牌、渠道、对话策略与系统参数。修改后保存即生效。"
        actions={
          <Button onClick={save} disabled={busy || !cfg}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {busy ? "保存中…" : "保存并生效"}
          </Button>
        }
      />

      {error && <ErrorState description={error} onRetry={reload} />}
      {!cfg && !error && <Skeleton className="h-72 w-full" />}

      {cfg && (
        <Tabs defaultValue="base">
          {/* 窄屏标签放不下,横向滚动而不是换行 */}
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="w-max">
              {CATEGORIES.map((c) => (
                <TabsTrigger key={c.value} value={c.value}>
                  <c.icon data-icon="inline-start" />
                  {c.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="base" className="pt-4">
            <SettingsGrid>
              <BrandSettings cfg={cfg} updateField={updateField} />
              <AdminSettings
                cfg={cfg}
                updateField={updateField}
                fieldValue={fieldValue}
                groups={groups}
                groupsLoading={groupsLoading}
                adminQq={adminQq}
                setAdminChannel={setAdminChannel}
                setAdminChatId={setAdminChatId}
                adminGroupOptions={adminGroupOptions}
                adminTgOptions={adminTgOptions}
              />
            </SettingsGrid>
          </TabsContent>

          <TabsContent value="channels" className="pt-4">
            <SettingsGrid>
              <QqSettings
                cfg={cfg}
                updateField={updateField}
                fieldValue={fieldValue}
                groups={groups}
                groupsLoading={groupsLoading}
                admins={admins}
                adminsLoading={adminsLoading}
                enabledQqIds={enabledQqIds}
                adminQq={adminQq}
                toggleGroup={toggleGroup}
                adminLabel={adminLabel}
                toggleExtraAt={toggleExtraAt}
                groupName={groupName}
              />
              <TgSettings
                cfg={cfg}
                setCfg={setCfg}
                enabledTgIds={enabledTgIds}
                tgChatDraft={tgChatDraft}
                setTgChatDraft={setTgChatDraft}
                addTgChat={addTgChat}
                removeTgChat={removeTgChat}
                tgTokenConfigured={tgTokenConfigured}
                tgBypassWarn={tgBypassWarn}
                tgChannel={tgChannel}
                tgChatTitle={tgChatTitle}
              />
            </SettingsGrid>
          </TabsContent>

          <TabsContent value="conversation" className="pt-4">
            <SettingsGrid>
              <ReplySettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
              />
              <SessionSettings cfg={cfg} setCfg={setCfg} />
              <ProactiveSettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
              />
            </SettingsGrid>
          </TabsContent>

          <TabsContent value="knowledge" className="pt-4">
            <SettingsGrid>
              <KnowledgePrefetchSettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
              />
              <ReflectSettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
              />
              <NotifySettings cfg={cfg} setCfg={setCfg} />
            </SettingsGrid>
          </TabsContent>

          <TabsContent value="advanced" className="pt-4">
            <SettingsGrid>
              <SdkSettings cfg={cfg} updateField={updateField} />
              <StorageSettings cfg={cfg} updateField={updateField} />
            </SettingsGrid>
          </TabsContent>
        </Tabs>
      )}

      {dirty && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-xs shadow-sm">
          <span className="text-muted-foreground">
            有未保存的改动,保存后立即生效。
          </span>
          <Button size="sm" onClick={save} disabled={busy || !cfg}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {busy ? "保存中…" : "保存并生效"}
          </Button>
        </div>
      )}
    </PageShell>
  )
}
